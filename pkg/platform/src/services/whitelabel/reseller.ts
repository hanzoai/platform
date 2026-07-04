/**
 * Reseller scoping — the org tree derived from `organization.parent_org_id`.
 *
 * A reseller sees/provisions only its own sub-tree; a Hanzo global admin sees
 * all. This is the pure tree logic + the scope gate the org-scoped routes use to
 * refuse a reseller reaching outside its sub-tree.
 */
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { organization } from "../../db/schema";
import { type OrgNode, subtreeIds } from "./logic";

/** All orgs (id, name, slug, parent) — the raw tree input. */
export async function allOrgs(): Promise<OrgNode[]> {
	const rows = await db
		.select({
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
			parentOrgId: organization.parentOrgId,
		})
		.from(organization);
	return rows.map((o) => ({
		id: o.id,
		name: o.name,
		slug: o.slug,
		parentOrgId: o.parentOrgId ?? null,
	}));
}

/**
 * Whether `resellerId` may act on `targetOrgId`: true when the target is in the
 * reseller's own sub-tree (inclusive). A global admin bypasses this (checked by
 * the caller); this function is the reseller-scoped gate.
 */
export async function resellerCanActOn(
	resellerId: string,
	targetOrgId: string,
): Promise<boolean> {
	if (resellerId === targetOrgId) return true;
	const orgs = await allOrgs();
	return subtreeIds(orgs, resellerId).has(targetOrgId);
}

/** The orgs a reseller may see/provision (its own sub-tree, inclusive). */
export async function resellerScope(resellerId: string): Promise<OrgNode[]> {
	const orgs = await allOrgs();
	const ids = subtreeIds(orgs, resellerId);
	return orgs.filter((o) => ids.has(o.id));
}

/** Set (or clear) an org's reseller parent. */
export async function setParentOrg(
	organizationId: string,
	parentOrgId: string | null,
): Promise<void> {
	await db
		.update(organization)
		.set({ parentOrgId })
		.where(eq(organization.id, organizationId));
}
