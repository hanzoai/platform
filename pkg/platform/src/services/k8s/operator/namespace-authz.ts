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
 * Normalize an organization id into a DNS label, for BUILDING a namespace name.
 * Used only by `tenantNamespace` — never to compare principals. Folding case
 * and punctuation is right when producing a k8s name and wrong when deciding
 * who someone is, so the fleet comparison below is exact `===`.
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
 * Fleet namespace ownership, as data — EMPTY by default, on purpose.
 *
 * Owners are `organization.id` values, which are per-install `nanoid()`s
 * (`Yb5GFGDBEwcLsv2O8qWjS`), NOT brand names. So there is no honest default to
 * ship: a table keyed by `hanzo`/`lux`/`zoo` would look like it worked, match no
 * real org, and make every fleet deploy fail — the "reports success, changes
 * nothing" class of bug in authorization form. An empty table instead means
 * fleet authority is OFF until an operator states it, which is also the safer
 * default: nobody holds fleet authority by accident.
 *
 * Configure with `PLATFORM_FLEET_NAMESPACE_OWNERS` (`ns=orgId,ns=orgId,…`)
 * using real organization ids. Until then only the tenant basis applies.
 */
export const DEFAULT_FLEET_NAMESPACE_OWNERS: NamespaceOwners = Object.freeze(
	Object.create(null),
);

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
	// Null prototype: a namespace key like `__proto__` must be an ordinary
	// entry, never a mutation of the object's prototype.
	const owners: Record<string, string> = Object.create(null);
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
		// A `tenant-*` key would hand a SECOND org write access to a tenant's
		// namespace — the one thing the tenant basis exists to make impossible.
		// Tenant namespaces are owned by derivation and are never configurable.
		if (namespace.startsWith("tenant-")) {
			throw new NamespaceOwnershipError(
				`${FLEET_NAMESPACE_OWNERS_ENV} may not assign the tenant namespace "${namespace}" — tenant ownership is derived, not configured`,
			);
		}
		// `ns=org=more` is a typo, not an owner named "org=more".
		if (org.includes("=")) {
			throw new NamespaceOwnershipError(
				`${FLEET_NAMESPACE_OWNERS_ENV} entry "${entry}" has more than one "="`,
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

	// OWN properties only. `namespace` is hostile input, and a plain-object
	// lookup walks the prototype chain: `owners["constructor"]` would return a
	// function, and a security decision must never crash on — or reason about —
	// something inherited from Object.prototype.
	const owner = Object.hasOwn(owners, namespace)
		? owners[namespace]
		: undefined;
	if (typeof owner === "string") {
		// EXACT match. `organizationId` is a trusted principal, so comparing it
		// leniently (case-folded, punctuation-folded) would only ever admit
		// someone it should not.
		if (owner === organizationId) return { decision: "allow", basis: "fleet" };
		// Do not name the owning org — the caller has no right to learn it.
		return {
			decision: "refuse",
			reason: `namespace "${namespace}" belongs to another organization`,
		};
	}

	// Say WHY there is no fleet basis at all, so an unconfigured install reads as
	// "not configured" instead of a mystery refusal.
	const hint =
		Object.keys(owners).length === 0
			? ` (no fleet namespaces are configured — set ${FLEET_NAMESPACE_OWNERS_ENV})`
			: "";
	return {
		decision: "refuse",
		reason: `namespace "${namespace}" is neither this org's tenant namespace "${tenantNs}" nor a fleet namespace it owns${hint}`,
	};
}
