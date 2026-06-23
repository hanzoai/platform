import type { ServerSession } from "@hanzo/iam/server";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";

/**
 * IAM → platform org membership (HIP-0111 Stage 2).
 *
 * Stage 1 made Hanzo IAM the sole *identity* provider; the platform still
 * owns the projects/services/deployments data model, every row of which FKs
 * into `organization` and `member`. This module is the single bridge that
 * derives that org/membership graph from the verified IAM access-token
 * claims — NOT from Better Auth's (now empty) organization plugin.
 *
 * One way to answer "which orgs may this caller see and manage?":
 *   - the caller's home org is the IAM `owner` claim (the Casdoor org that
 *     owns the `sub` = "org/username"); they are an `owner` of it.
 *   - a global admin (IAM `isGlobalAdmin`, or owned by the `admin` org per
 *     IAM_MIGRATION.md) is an `owner` of EVERY org the platform knows about,
 *     so global-admin ⟺ manage all orgs.
 *
 * Idempotent: safe to run on every request. It only ever creates the rows
 * that are missing and promotes a member's role when the IAM claims say so;
 * it never deletes memberships (a user removed from an org in IAM keeps any
 * historical platform data — revocation is a Stage-2 follow-up, tracked, and
 * deliberately out of scope here so we never silently drop access mid-flight).
 */

/** Owning org reserved by IAM for global administrators. */
const GLOBAL_ADMIN_OWNER = "admin";

/** Truthy across the JSON shapes Casdoor uses for booleans (`true`/"true"). */
const isTrue = (v: unknown): boolean => v === true || v === "true";

/**
 * Is this identity a global administrator? Two independent signals, either
 * sufficient:
 *   1. the `isGlobalAdmin` JWT claim Casdoor stamps on global admins, and
 *   2. ownership by the reserved `admin` org (the IAM_MIGRATION.md convention).
 */
export const isGlobalAdmin = (identity: ServerSession): boolean =>
	isTrue(identity.claims.isGlobalAdmin) ||
	identity.owner === GLOBAL_ADMIN_OWNER;

/**
 * Resolve the platform `organization` row for an IAM org name, creating it on
 * first sight. The IAM org name is the stable key, stored in `slug` (which is
 * `unique`), so the same Casdoor org always maps to the same platform org row
 * regardless of display-name edits.
 *
 * `ownerId` is required and FKs into `user`; we seed it with the first user we
 * see owning the org (the caller, for their home org) and never churn it.
 */
const ensureOrganization = async (
	iamOrgName: string,
	fallbackOwnerUserId: string,
	now: Date,
): Promise<typeof schema.organization.$inferSelect> => {
	const existing = await db.query.organization.findFirst({
		where: eq(schema.organization.slug, iamOrgName),
	});
	if (existing) {
		return existing;
	}

	const [created] = await db
		.insert(schema.organization)
		.values({
			name: iamOrgName,
			slug: iamOrgName,
			ownerId: fallbackOwnerUserId,
			createdAt: now,
		})
		.onConflictDoNothing({ target: schema.organization.slug })
		.returning();

	if (created) {
		return created;
	}

	// Lost an insert race with a concurrent request — the row now exists.
	const raced = await db.query.organization.findFirst({
		where: eq(schema.organization.slug, iamOrgName),
	});
	if (!raced) {
		throw new Error(
			`organization '${iamOrgName}' could not be created or found`,
		);
	}
	return raced;
};

/**
 * Ensure the user is a member of the org with at least `role`. Creates the
 * `member` row when absent; promotes a weaker existing role (member → owner)
 * but never demotes — a higher locally-granted role is left intact.
 */
const ensureMembership = async (
	userId: string,
	organizationId: string,
	role: "owner" | "member",
	now: Date,
): Promise<void> => {
	const existing = await db.query.member.findFirst({
		where: and(
			eq(schema.member.userId, userId),
			eq(schema.member.organizationId, organizationId),
		),
	});

	if (!existing) {
		await db
			.insert(schema.member)
			.values({ userId, organizationId, role, createdAt: now })
			.onConflictDoNothing();
		return;
	}

	// Promote member → owner when IAM now grants ownership; never demote.
	if (role === "owner" && existing.role === "member") {
		await db
			.update(schema.member)
			.set({ role: "owner" })
			.where(eq(schema.member.id, existing.id));
	}
};

/**
 * Sync the platform org/membership graph for a verified IAM identity, and
 * return the org id the caller should land in (their home org).
 *
 * This is the keystone of Stage 2 — `upsertUserFromIam` calls it so that
 * `session.activeOrganizationId` is populated and every downstream
 * `member`-scoped authz check (`findMemberByUserId`, `checkPermission`,
 * `resolvePermissions`, `organization.all`, `project.all`) resolves instead
 * of failing closed on an empty org set.
 */
export const syncIamOrgMembership = async (
	identity: ServerSession,
	userId: string,
): Promise<{ activeOrganizationId: string; role: "owner" | "member" }> => {
	const now = new Date();
	const global = isGlobalAdmin(identity);

	// The IAM `owner` claim is the home-org key. The @hanzo/iam server lib
	// guarantees it is non-empty (falls back to the configured orgName, else
	// "unknown"), but fail closed rather than ever key an org on "" — an empty
	// slug would collapse every tokenless-owner principal into one shared org.
	const ownerOrg = identity.owner?.trim();
	if (!ownerOrg) {
		throw new Error("IAM identity has no owner claim; cannot resolve org");
	}

	// Home org: the caller's IAM owner. They own it (a Casdoor org member is
	// the operator of their own platform org). Global admins own it too.
	const homeOrg = await ensureOrganization(ownerOrg, userId, now);
	await ensureMembership(userId, homeOrg.id, "owner", now);

	// Global admin ⟺ manage every org. Make them an owner of all known orgs
	// so the org switcher and per-org PaaS views span the whole platform.
	if (global) {
		const allOrgs = await db.query.organization.findMany({
			columns: { id: true },
		});
		for (const org of allOrgs) {
			if (org.id === homeOrg.id) continue;
			await ensureMembership(userId, org.id, "owner", now);
		}
	}

	return { activeOrganizationId: homeOrg.id, role: "owner" };
};
