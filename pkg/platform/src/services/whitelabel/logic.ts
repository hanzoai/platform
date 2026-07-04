/**
 * Pure white-label logic — no IO, no db, no k8s. Extracted so it is unit-tested
 * in isolation (the codebase convention: pure decisions live apart from the
 * thin IO that calls them).
 */
import type { PackageServiceStatus, TenantPackage } from "../../db/schema";
import type { PlanTier } from "../k8s/operator";

/** Normalize a host: lowercase, strip a leading protocol and any path/port. */
export function normalizeHost(host: string): string {
	return host
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, "")
		.split("/")[0]!
		.split(":")[0]!;
}

/** Ingress object name for a bound host: DNS-safe, unique per host, ≤63 chars. */
export function ingressNameForHost(host: string): string {
	return `wl-${normalizeHost(host).replace(/[^a-z0-9-]/g, "-")}`.slice(0, 63);
}

/** Expand `{slug}` in a pattern (domainPattern / appPattern) to the org slug. */
export function expandPattern(pattern: string, slug: string): string {
	return pattern.replace(/\{slug\}/g, slug);
}

/** Map a package `plan` to the platform's `PlanTier` (quota) vocabulary. */
export function planTierOf(plan: string): PlanTier {
	switch (plan) {
		case "enterprise":
			return "enterprise";
		case "growth":
			return "pro";
		case "starter":
			return "starter";
		default:
			return "free";
	}
}

/** Roll per-service states up to the grant status. */
export function rollupStatus(
	statuses: PackageServiceStatus[],
): TenantPackage["status"] {
	if (statuses.length === 0) return "provisioning";
	if (statuses.some((s) => s.state === "failed")) return "failed";
	if (statuses.every((s) => s.state === "provisioned")) return "active";
	return "partial";
}

export interface OrgNode {
	id: string;
	name: string;
	slug: string | null;
	parentOrgId: string | null;
}

/**
 * The set of org ids in `rootId`'s sub-tree (inclusive), computed by walking
 * `parentOrgId` edges. Cycle-safe (a visited set bounds the walk).
 */
export function subtreeIds(orgs: OrgNode[], rootId: string): Set<string> {
	const childrenOf = new Map<string, string[]>();
	for (const o of orgs) {
		if (o.parentOrgId) {
			const arr = childrenOf.get(o.parentOrgId) ?? [];
			arr.push(o.id);
			childrenOf.set(o.parentOrgId, arr);
		}
	}
	const out = new Set<string>();
	const stack = [rootId];
	while (stack.length) {
		const id = stack.pop()!;
		if (out.has(id)) continue;
		out.add(id);
		for (const child of childrenOf.get(id) ?? []) stack.push(child);
	}
	return out;
}
