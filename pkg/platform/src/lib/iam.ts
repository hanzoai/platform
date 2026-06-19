import type { IncomingMessage } from "node:http";
import { getServerSession, type ServerSession } from "@hanzo/iam/server";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";

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
	const image =
		typeof claims.picture === "string" ? claims.picture : undefined;
	const now = new Date();

	// IAM `sub` is the stable subject ("org/username"); use it as the local id
	// so the same IAM principal always maps to the same platform user row.
	const userId = identity.userId;

	let row = await db.query.user.findFirst({
		where: eq(schema.user.id, userId),
	});
	if (!row) {
		row = await db.query.user.findFirst({
			where: eq(schema.user.email, email),
		});
	}

	if (row) {
		[row] = await db
			.update(schema.user)
			.set({
				email,
				firstName: firstName || row.firstName,
				lastName: lastName || row.lastName,
				emailVerified: true,
				isRegistered: true,
				image: image ?? row.image,
				updatedAt: now,
			})
			.where(eq(schema.user.id, row.id))
			.returning();
	} else {
		[row] = await db
			.insert(schema.user)
			.values({
				id: userId,
				email,
				firstName: firstName || "",
				lastName,
				emailVerified: true,
				isRegistered: true,
				image,
				updatedAt: now,
			})
			.returning();
	}

	const member = await db.query.member.findFirst({
		where: eq(schema.member.userId, row.id),
		orderBy: desc(schema.member.createdAt),
		with: { organization: true },
	});

	return {
		session: {
			userId: row.id,
			activeOrganizationId: member?.organizationId ?? "",
		},
		user: {
			...row,
			name: [row.firstName, row.lastName].filter(Boolean).join(" "),
			role: member?.role || row.role || "member",
			ownerId: member?.organization.ownerId || row.id,
		},
	};
};
