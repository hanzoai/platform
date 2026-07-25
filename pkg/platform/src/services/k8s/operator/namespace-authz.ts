/**
 * Namespace ownership — the ONE authorization rule for writing an operator CR.
 *
 * Every namespace platform may write into resolves to exactly one owning
 * organization. A write is authorized iff that owner IS the acting org. This
 * module is the only place that relation is defined; callers ask, they do not
 * re-derive.
 *
 * There are exactly two ownership bases, and nothing else is deployable:
 *
 *   tenant  `ns === tenantNamespace(org)` — DERIVED from the org, so it is
 *           unforgeable: no namespace string can satisfy this for an org other
 *           than the one acting. This is how every PaaS tenant is confined.
 *
 *   fleet   `owners[ns] === org` — our own long-lived estate namespaces
 *           (`hanzo`, `hanzo-testnet`, `hanzo-devnet`, and the lux/zoo
 *           equivalents), which predate the tenant scheme and are where the
 *           overwhelming majority of workloads actually run. Ownership here is
 *           OPERATOR-CONTROLLED DATA (the table below, overridable by env) —
 *           never anything a connected repo can influence.
 *
 * Why this is not just a wider allowlist: the fleet table is keyed by namespace
 * and VALUED by org, so widening it admits a namespace for ONE org, not for
 * everyone. A bare list of "system namespaces" would have let any tenant push an
 * image into `hanzo` — the exact hole this module exists to close.
 *
 * Fail closed: an unknown namespace is denied. There is no wildcard, no prefix
 * match, and no escape hatch.
 *
 * NOTE — deliberately NOT merged with `apps/inventory.ts:DEFAULT_TARGETS`.
 * That table is the OBSERVATION scope (which namespaces platform scans, and
 * what env each maps to) and is shared by every org; this one is the WRITE
 * authority (which org may mutate a namespace). Conflating them would grant
 * every org write access to everything platform can see.
 */

/**
 * Normalize an organization id to the character set a namespace segment
 * allows. Shared by `tenantNamespace` and the fleet-owner comparison so the
 * two bases cannot disagree about what "the same org" means (e.g. casing).
 */
function normalizeOrg(organizationId: string): string {
	return organizationId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

/**
 * Canonical tenant namespace name. All operator-managed CRs for a PaaS tenant
 * live in this namespace. Format must match the operator's tenant-mode webhook
 * regex: `^tenant-[a-z0-9-]{1,55}$`.
 */
export function tenantNamespace(organizationId: string): string {
	return `tenant-${normalizeOrg(organizationId)}`;
}

/** Namespace → owning organization id. */
export type NamespaceOwners = Readonly<Record<string, string>>;

/**
 * Fleet namespace ownership, as data.
 *
 * These are the estate namespaces that existed before the `tenant-*` scheme and
 * that hold ~99% of running workloads. Each is owned by the org whose fleet it
 * is, so the entry both ENABLES that org and REFUSES every other one.
 *
 * Override wholesale with `PLATFORM_FLEET_NAMESPACE_OWNERS` (see
 * `fleetNamespaceOwners`) — adding an org's fleet is config, not a code change.
 */
export const DEFAULT_FLEET_NAMESPACE_OWNERS: NamespaceOwners = {
	hanzo: "hanzo",
	"hanzo-testnet": "hanzo",
	"hanzo-devnet": "hanzo",
	lux: "lux",
	"lux-testnet": "lux",
	"lux-devnet": "lux",
	zoo: "zoo",
	"zoo-testnet": "zoo",
	"zoo-devnet": "zoo",
};

/** Env var carrying a wholesale replacement for the fleet ownership table. */
export const FLEET_NAMESPACE_OWNERS_ENV = "PLATFORM_FLEET_NAMESPACE_OWNERS";

export class NamespaceOwnershipError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NamespaceOwnershipError";
	}
}

/**
 * Parse `ns=org,ns=org,…` into an ownership table.
 *
 * Throws on any malformed entry rather than skipping it: a typo in the
 * ownership table must be loud, never a silent narrowing (deploys mysteriously
 * refused) or a silent widening.
 */
export function parseFleetNamespaceOwners(spec: string): NamespaceOwners {
	const owners: Record<string, string> = {};
	for (const raw of spec.split(",")) {
		const entry = raw.trim();
		if (entry.length === 0) continue;
		const eq = entry.indexOf("=");
		if (eq <= 0 || eq === entry.length - 1) {
			throw new NamespaceOwnershipError(
				`${FLEET_NAMESPACE_OWNERS_ENV} entry "${entry}" must be "namespace=organizationId"`,
			);
		}
		const namespace = entry.slice(0, eq).trim();
		const org = entry.slice(eq + 1).trim();
		if (namespace.length === 0 || org.length === 0) {
			throw new NamespaceOwnershipError(
				`${FLEET_NAMESPACE_OWNERS_ENV} entry "${entry}" must be "namespace=organizationId"`,
			);
		}
		if (owners[namespace] !== undefined && owners[namespace] !== org) {
			throw new NamespaceOwnershipError(
				`${FLEET_NAMESPACE_OWNERS_ENV} assigns namespace "${namespace}" to two organizations`,
			);
		}
		owners[namespace] = org;
	}
	return owners;
}

/**
 * The fleet ownership table in force: the env override when set (wholesale
 * replacement — one source of truth once configured), else the default.
 */
export function fleetNamespaceOwners(
	env: Record<string, string | undefined> = process.env,
): NamespaceOwners {
	const spec = env[FLEET_NAMESPACE_OWNERS_ENV]?.trim();
	if (!spec) return DEFAULT_FLEET_NAMESPACE_OWNERS;
	return parseFleetNamespaceOwners(spec);
}

/**
 * Why a namespace write was allowed, or why it was refused.
 *
 * Discriminated on a STRING literal, not a boolean: this package compiles with
 * `strictNullChecks: false`, under which TypeScript does not narrow boolean
 * literal discriminants — a security decision must never be readable only by
 * an unchecked cast.
 */
export type NamespaceAuthz =
	| { decision: "allow"; basis: "tenant" | "fleet" }
	| { decision: "refuse"; reason: string };

/**
 * Decide whether `organizationId` may write operator CRs in `namespace`.
 *
 * Total and fail-closed. `namespace` is UNTRUSTED (it comes verbatim from a
 * connected repo's `hanzo.yml`); `organizationId` is trusted (platform resolves
 * it from the webhook→repo→org binding, never from repo content).
 */
export function authorizeNamespace(
	namespace: string,
	organizationId: string,
	owners: NamespaceOwners = fleetNamespaceOwners(),
): NamespaceAuthz {
	const tenantNs = tenantNamespace(organizationId);
	if (namespace === tenantNs) return { decision: "allow", basis: "tenant" };

	const owner = owners[namespace];
	if (owner !== undefined) {
		if (normalizeOrg(owner) === normalizeOrg(organizationId)) {
			return { decision: "allow", basis: "fleet" };
		}
		// Do not name the owning org — the caller has no right to learn it.
		return {
			decision: "refuse",
			reason: `namespace "${namespace}" belongs to another organization`,
		};
	}

	return {
		decision: "refuse",
		reason: `namespace "${namespace}" is neither this org's tenant namespace "${tenantNs}" nor a fleet namespace it owns`,
	};
}
