/**
 * Namespace authorization — the security boundary of the CI deploy leg.
 *
 * The property under test: a deploy may write ONLY into a namespace that
 * resolves to the deploying org. `namespace` is attacker-controlled (it comes
 * verbatim from a connected repo's `hanzo.yml`), so every test here treats it
 * as hostile input.
 *
 * Org ids are nanoid-shaped throughout, because that is what
 * `organization.id` actually is in production (the live fleet org is
 * `Yb5GFGDBEwcLsv2O8qWjS`, slug `hanzo`). Testing with readable brand names
 * would let a brand-keyed authorization bug pass green while being inert — or
 * dangerous — against a real database.
 */
import {
	authorizeNamespace,
	DEFAULT_FLEET_NAMESPACE_OWNERS,
	FLEET_NAMESPACE_OWNERS_ENV,
	fleetNamespaceOwners,
	NamespaceOwnershipError,
	parseFleetNamespaceOwners,
	tenantNamespace,
} from "@hanzo/platform/services/k8s/operator/namespace-authz";
import { describe, expect, it } from "vitest";

const FLEET_ORG = "Yb5GFGDBEwcLsv2O8qWjS";
const LUX_ORG = "Lx7QpZm2NvKd8RtYeWc1A";
const TENANT_ORG = "Mx3KpQr9TvBn2WsLdYe5F";

/** A configured install: fleet namespaces mapped to real org ids. */
const OWNERS = parseFleetNamespaceOwners(
	`hanzo=${FLEET_ORG},hanzo-testnet=${FLEET_ORG},hanzo-devnet=${FLEET_ORG},lux=${LUX_ORG}`,
);

/** Assert-and-narrow helper so a refusal test cannot silently read a pass. */
function refusal(ns: string, org: string, owners = OWNERS) {
	const authz = authorizeNamespace(ns, org, owners);
	if (authz.decision !== "refuse") {
		throw new Error(
			`expected "${org}" to be REFUSED namespace "${ns}", got allow via ${authz.basis}`,
		);
	}
	return authz.reason;
}

describe("tenantNamespace", () => {
	it("derives a DNS-label tenant namespace from the org id", () => {
		expect(tenantNamespace(TENANT_ORG)).toBe("tenant-mx3kpqr9tvbn2wsldye5f");
		expect(tenantNamespace("ORG_42")).toBe("tenant-org-42");
	});
});

describe("authorizeNamespace — tenant basis", () => {
	it("allows an org into its own tenant namespace", () => {
		expect(authorizeNamespace(tenantNamespace(TENANT_ORG), TENANT_ORG)).toEqual(
			{
				decision: "allow",
				basis: "tenant",
			},
		);
	});

	it("REFUSES an org into another org's tenant namespace", () => {
		expect(refusal(tenantNamespace(FLEET_ORG), TENANT_ORG)).toContain(
			"is neither this org's tenant namespace",
		);
	});

	it("REFUSES a look-alike tenant namespace", () => {
		const ns = tenantNamespace(TENANT_ORG);
		expect(refusal(`${ns}-evil`, TENANT_ORG)).toBeTruthy();
		expect(refusal(ns.slice(0, -1), TENANT_ORG)).toBeTruthy();
		expect(refusal(`x${ns}`, TENANT_ORG)).toBeTruthy();
	});

	it("works with no fleet table configured at all", () => {
		// Tenant isolation must not depend on the fleet table existing.
		expect(
			authorizeNamespace(tenantNamespace(TENANT_ORG), TENANT_ORG, {}).decision,
		).toBe("allow");
	});
});

describe("authorizeNamespace — fleet basis", () => {
	it("allows the owning org into each of its fleet namespaces", () => {
		for (const ns of ["hanzo", "hanzo-testnet", "hanzo-devnet"]) {
			expect(authorizeNamespace(ns, FLEET_ORG, OWNERS)).toEqual({
				decision: "allow",
				basis: "fleet",
			});
		}
	});

	it("🔴 REFUSES a tenant org reaching into a fleet namespace", () => {
		// THE cross-tenant property.
		for (const ns of ["hanzo", "hanzo-testnet", "hanzo-devnet", "lux"]) {
			expect(refusal(ns, TENANT_ORG)).toBe(
				`namespace "${ns}" belongs to another organization`,
			);
		}
	});

	it("REFUSES one fleet org reaching into another fleet org's namespace", () => {
		expect(refusal("lux", FLEET_ORG)).toBeTruthy();
		expect(refusal("hanzo", LUX_ORG)).toBeTruthy();
	});

	it("does not name the owning org in the refusal", () => {
		// The caller has no right to learn WHO owns a namespace it cannot touch.
		const reason = refusal("hanzo", TENANT_ORG);
		expect(reason).toBe('namespace "hanzo" belongs to another organization');
		expect(reason).not.toContain(FLEET_ORG);
	});

	it("requires an EXACT principal match — no case or punctuation folding", () => {
		// Folding a trusted principal can only ever admit someone it should not.
		expect(refusal("hanzo", FLEET_ORG.toLowerCase())).toBeTruthy();
		expect(refusal("hanzo", FLEET_ORG.toUpperCase())).toBeTruthy();
		// Punctuation must be ADDED to vary the principal: FLEET_ORG is
		// alphanumeric, so a `replace("_", "-")` here is a no-op and the
		// assertion silently inverts into "the rightful owner must be refused".
		expect(refusal("hanzo", `${FLEET_ORG}-`)).toBeTruthy();
		expect(
			refusal("hanzo", `${FLEET_ORG.slice(0, 5)}-${FLEET_ORG.slice(5)}`),
		).toBeTruthy();
		expect(refusal("hanzo", ` ${FLEET_ORG}`)).toBeTruthy();
	});
});

describe("authorizeNamespace — fail closed", () => {
	it("REFUSES namespaces nobody owns", () => {
		for (const ns of ["kube-system", "default", "cert-manager", "hanzo-git"]) {
			expect(refusal(ns, FLEET_ORG)).toContain("is neither this org's tenant");
		}
	});

	it("REFUSES the empty namespace", () => {
		expect(refusal("", FLEET_ORG)).toBeTruthy();
	});

	it("has no wildcard or prefix escape", () => {
		expect(refusal("hanzo-anything", FLEET_ORG)).toBeTruthy();
		expect(refusal("*", FLEET_ORG)).toBeTruthy();
	});

	it("REFUSES cleanly for inherited Object keys instead of throwing", () => {
		// A plain-object lookup walks the prototype chain, so `owners["constructor"]`
		// would return a function and blow up the comparison with a TypeError —
		// a 500 instead of the recorded refusal. Own-property lookup only.
		for (const ns of ["constructor", "toString", "__proto__", "valueOf"]) {
			expect(() => authorizeNamespace(ns, FLEET_ORG, OWNERS)).not.toThrow();
			expect(refusal(ns, FLEET_ORG)).toContain("is neither this org's tenant");
		}
	});
});

describe("fleet ownership is operator-configured data", () => {
	it("ships EMPTY, so nobody holds fleet authority by accident", () => {
		// Org ids are per-install nanoids, so there is no honest default. An empty
		// table is off-until-stated rather than a default that silently matches
		// nothing.
		expect(Object.keys(DEFAULT_FLEET_NAMESPACE_OWNERS)).toHaveLength(0);
		expect(authorizeNamespace("hanzo", FLEET_ORG, {}).decision).toBe("refuse");
	});

	it("says WHY when no fleet table is configured", () => {
		// An unconfigured install must read as "not configured", not as a mystery.
		expect(refusal("hanzo", FLEET_ORG, {})).toContain(
			FLEET_NAMESPACE_OWNERS_ENV,
		);
	});

	it("parses an ownership spec keyed by namespace, valued by org id", () => {
		expect(
			parseFleetNamespaceOwners(` hanzo=${FLEET_ORG}, lux=${LUX_ORG} `),
		).toEqual({ hanzo: FLEET_ORG, lux: LUX_ORG });
	});

	it("throws loudly on a malformed entry rather than skipping it", () => {
		expect(() => parseFleetNamespaceOwners("hanzo")).toThrow(
			NamespaceOwnershipError,
		);
		expect(() => parseFleetNamespaceOwners("=org")).toThrow(
			NamespaceOwnershipError,
		);
		expect(() => parseFleetNamespaceOwners("hanzo=")).toThrow(
			NamespaceOwnershipError,
		);
		// `ns=org=more` is a typo, not an org literally named "org=more".
		expect(() => parseFleetNamespaceOwners("hanzo=a=b")).toThrow(
			/more than one/,
		);
	});

	it("REFUSES to configure a tenant namespace", () => {
		// Would hand a SECOND org write access to a tenant — the one thing the
		// tenant basis exists to make impossible.
		expect(() =>
			parseFleetNamespaceOwners(`tenant-victim=${TENANT_ORG}`),
		).toThrow(/tenant ownership is derived, not configured/);
	});

	it("throws when one namespace is assigned to two orgs", () => {
		expect(() =>
			parseFleetNamespaceOwners(`hanzo=${FLEET_ORG},hanzo=${LUX_ORG}`),
		).toThrow(/two organizations/);
	});

	it("treats a __proto__ entry as an ordinary namespace, not a prototype write", () => {
		const owners = parseFleetNamespaceOwners(
			`__proto__=${LUX_ORG},hanzo=${FLEET_ORG}`,
		);
		expect(authorizeNamespace("hanzo", FLEET_ORG, owners).decision).toBe(
			"allow",
		);
		expect(authorizeNamespace("__proto__", FLEET_ORG, owners).decision).toBe(
			"refuse",
		);
		// The prototype of a fresh object is untouched.
		expect(({} as Record<string, unknown>).hanzo).toBeUndefined();
	});

	it("env override supplies the table; blank falls back to the empty default", () => {
		const owners = fleetNamespaceOwners({
			[FLEET_NAMESPACE_OWNERS_ENV]: `hanzo=${FLEET_ORG}`,
		});
		expect(authorizeNamespace("hanzo", FLEET_ORG, owners).decision).toBe(
			"allow",
		);
		expect(fleetNamespaceOwners({})).toBe(DEFAULT_FLEET_NAMESPACE_OWNERS);
		expect(fleetNamespaceOwners({ [FLEET_NAMESPACE_OWNERS_ENV]: "  " })).toBe(
			DEFAULT_FLEET_NAMESPACE_OWNERS,
		);
	});

	it("a configured org still cannot reach a namespace it does not own", () => {
		const owners = fleetNamespaceOwners({
			[FLEET_NAMESPACE_OWNERS_ENV]: `hanzo=${FLEET_ORG},lux=${LUX_ORG}`,
		});
		expect(authorizeNamespace("hanzo", LUX_ORG, owners).decision).toBe(
			"refuse",
		);
	});
});
