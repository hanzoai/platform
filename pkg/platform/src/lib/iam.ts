import type { IncomingMessage } from "node:http";
import { getServerSession, type ServerSession } from "@hanzo/iam/server";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { isGlobalAdmin, syncIamOrgMembership } from "./iam-org";

/**
 * Hanzo IAM (HIP-0111) is the SOLE identity provider for the platform.
 *
 * One way to answer "who is calling?" on the server: verify the IAM access
 * token (Bearer header or the `hanzo_iam_access_token` cookie) against the
 * issuer's JWKS and resolve it onto the local data model. No platform-local
 * passwords, no Better Auth sessions — IAM owns every credential interaction.
 *
 * Issuer is `https://hanzo.id` (the per-brand OIDC issuer), exactly like the
 * console — the proven prod path. The `@hanzo/iam` SDK drives
 * `/v1/iam/oauth/{authorize,token,userinfo,logout}` + `/v1/iam/.well-known/jwks`
 * off that origin. client_id `hanzo-platform`. Never `/api/`.
 */
export const IAM = {
	serverUrl: (
		process.env.IAM_SERVER_URL ||
		process.env.IAM_URL ||
		process.env.IAM_ENDPOINT ||
		"https://hanzo.id"
	).replace(/\/$/, ""),
	clientId:
		process.env.IAM_CLIENT_ID ||
		process.env.HANZO_IAM_CLIENT_ID ||
		"hanzo-platform",
} as const;

/**
 * Resolve the IAM session for an inbound request. Reads the Bearer token or
 * the `hanzo_iam_access_token` cookie, verifies it against `hanzo.id`'s
 * JWKS, and fails closed on a bad audience. Returns `null` when no valid
 * token is present.
 */
export const getIamServerSession = (
	request: IncomingMessage,
): Promise<ServerSession | null> => getServerSession(request, IAM);

/**
 * The `{ session, user }` shape every `validateRequest` caller expects. Keeps
 * the FK data model intact: `user` is a row in the `user` table and `session`
 * carries the active organization id used by the `member`/`organization`
 * lookups downstream.
 */
export interface PlatformSession {
	session: {
		userId: string;
		activeOrganizationId: string;
	};
	user: typeof schema.user.$inferSelect & {
		name: string;
		ownerId: string;
	};
}

/**
 * Upsert the local `user` row from a verified IAM identity, then resolve the
 * caller's active organization membership. This is the single bridge between
 * IAM (source of truth for identity) and the platform data model (source of
 * truth for projects/deployments/domains, all of which FK into `user` and
 * `organization`).
 *
 * Match order: IAM `sub` (stored as the `user.id`) first, then `email`. A
 * pre-existing local row keyed by email is adopted so historical accounts are
 * never duplicated.
 */
export const upsertUserFromIam = async (
	identity: ServerSession,
): Promise<PlatformSession> => {
	const email = identity.email ?? identity.claims.email;
	if (!email) {
		throw new Error("IAM token has no email claim; cannot resolve user");
	}

	const claims = identity.claims;
	const displayName =
		(typeof claims.name === "string" && claims.name) ||
		(typeof claims.preferred_username === "string" &&
			claims.preferred_username) ||
		email;
	const [firstName, ...rest] = displayName.split(" ");
	const lastName = rest.join(" ");
	const image = typeof claims.picture === "string" ? claims.picture : undefined;
	const now = new Date();

	// IAM `sub` is the stable subject ("org/username"); use it as the local id
	// so the same IAM principal always maps to the same platform user row.
	const userId = identity.userId;

	// Stage 2: the user-level `role` column is the platform-wide admin signal
	// that the Better Auth admin plugin reads (`has-permission`: role "admin"
	// authorizes every admin endpoint, e.g. /v1/auth/admin/list-users for the
	// impersonation bar). Derive it from IAM — a global admin gets "admin";
	// everyone else stays a plain "user". This keeps IAM the single source of
	// truth for global-admin instead of the stale USER_ADMIN_ID env.
	const platformRole = isGlobalAdmin(identity) ? "admin" : "user";

	const existing =
		(await db.query.user.findFirst({
			where: eq(schema.user.id, userId),
		})) ??
		(await db.query.user.findFirst({
			where: eq(schema.user.email, email),
		}));

	const [row] = existing
		? await db
				.update(schema.user)
				.set({
					email,
					firstName: firstName || existing.firstName,
					lastName: lastName || existing.lastName,
					emailVerified: true,
					isRegistered: true,
					image: image ?? existing.image,
					role: platformRole,
					updatedAt: now,
				})
				.where(eq(schema.user.id, existing.id))
				.returning()
		: await db
				.insert(schema.user)
				.values({
					id: userId,
					email,
					firstName: firstName || "",
					lastName,
					emailVerified: true,
					isRegistered: true,
					image,
					role: platformRole,
					updatedAt: now,
				})
				.returning();

	// A matched UPDATE or a fresh INSERT always returns exactly one row; if the
	// driver yields nothing the data model is broken — fail closed, never deref
	// undefined.
	if (!row) {
		throw new Error("IAM user upsert returned no row");
	}

	// Stage 2: org membership derives from the IAM claims, not Better Auth's
	// (empty) organization plugin. This ensures the caller's home org +
	// membership exist (and every org, for a global admin) and yields the
	// active org so the downstream member-scoped authz checks resolve instead
	// of failing closed on an empty org set.
	const { activeOrganizationId, role } = await syncIamOrgMembership(
		identity,
		row.id,
	);

	const member = await db.query.member.findFirst({
		where: and(
			eq(schema.member.userId, row.id),
			eq(schema.member.organizationId, activeOrganizationId),
		),
		with: { organization: true },
	});

	// `ctx.user.role` is read on TWO axes by downstream callers and must satisfy
	// both: project.all / adminProcedure check `=== "owner" || === "admin"`
	// (membership role), and haveRootAccess checks `=== "admin"` (platform-wide
	// global-admin). So a global admin (row.role "admin") surfaces as "admin"
	// (satisfies every check); everyone else gets their org-membership role
	// ("owner" for their own org), NOT the platform-wide "user". The membership
	// role must never shadow the global-admin signal.
	const effectiveRole =
		row.role === "admin" ? "admin" : member?.role || role;

	return {
		session: {
			userId: row.id,
			activeOrganizationId,
		},
		user: {
			...row,
			name: [row.firstName, row.lastName].filter(Boolean).join(" "),
			role: effectiveRole,
			ownerId: member?.organization?.ownerId || row.id,
		},
	};
};
