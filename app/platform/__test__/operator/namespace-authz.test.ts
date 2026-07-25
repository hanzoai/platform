/**
 * Namespace authorization — the security boundary of the CI deploy leg.
 *
 * The property under test: a deploy may write ONLY into a namespace that
 * resolves to the deploying org. `target.namespace` is attacker-controlled
 * (it comes verbatim from a connected repo's `hanzo.yml`), so every test here
 * treats it as hostile input.
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

/** Assert-and-narrow helper so a refusal test cannot silently read a pass. */
function refusal(ns: string, org: string, owners?: Record<string, string>) {
	const authz = authorizeNamespace(ns, org, owners);
	if (authz.decision !== "refuse") {
		throw new Error(
			`expected "${org}" to be REFUSED namespace "${ns}", got allow via ${authz.basis}`,
		);
	}
	return authz.reason;
}

describe("tenantNamespace", () => {
	it("derives the tenant namespace from the org id", () => {
		expect(tenantNamespace("maxpower")).toBe("tenant-maxpower");
		expect(tenantNamespace("hanzo")).toBe("tenant-hanzo");
	});

	it("normalizes to the operator's ^tenant-[a-z0-9-]+$ shape", () => {
		expect(tenantNamespace("Acme Corp")).toBe("tenant-acme-corp");
		expect(tenantNamespace("ORG_42")).toBe("tenant-org-42");
	});
});

describe("authorizeNamespace — tenant basis", () => {
	it("allows an org into its own tenant namespace", () => {
		const authz = authorizeNamespace("tenant-maxpower", "maxpower");
		expect(authz).toEqual({ decision: "allow", basis: "tenant" });
	});

	it("REFUSES an org into another org's tenant namespace", () => {
		expect(refusal("tenant-hanzo", "maxpower")).toContain(
			"is neither this org's tenant namespace",
		);
	});

	it("REFUSES a look-alike tenant namespace", () => {
		// Prefix/suffix games must not be admitted by a loose match.
		expect(refusal("tenant-maxpower-evil", "maxpower")).toBeTruthy();
		expect(refusal("tenant-maxpowe", "maxpower")).toBeTruthy();
		expect(refusal("xtenant-maxpower", "maxpower")).toBeTruthy();
	});
});

describe("authorizeNamespace — fleet basis", () => {
	it("allows the owning org into each of its fleet namespaces", () => {
		for (const ns of ["hanzo", "hanzo-testnet", "hanzo-devnet"]) {
			expect(authorizeNamespace(ns, "hanzo")).toEqual({
				decision: "allow",
				basis: "fleet",
			});
		}
	});

	it("allows the lux and zoo orgs into their own fleets", () => {
		expect(authorizeNamespace("lux", "lux").decision).toBe("allow");
		expect(authorizeNamespace("zoo-testnet", "zoo").decision).toBe("allow");
	});

	it("🔴 REFUSES a tenant org reaching into a fleet namespace", () => {
		// THE cross-tenant property. `maxpower` is a real tenant on the shared
		// cluster; `hanzo` is where the production fleet runs.
		for (const ns of ["hanzo", "hanzo-testnet", "hanzo-devnet", "lux", "zoo"]) {
			expect(refusal(ns, "maxpower")).toBe(
				`namespace "${ns}" belongs to another organization`,
			);
		}
	});

	it("REFUSES one fleet org reaching into another fleet org's namespace", () => {
		expect(refusal("lux", "hanzo")).toBeTruthy();
		expect(refusal("hanzo", "zoo")).toBeTruthy();
	});

	it("does not name the owning org in the refusal", () => {
		// The caller has no right to learn WHO owns a namespace it cannot touch.
		// Use an owner whose name differs from the namespace, so echoing the
		// caller's own input cannot be mistaken for disclosing the owner.
		const reason = refusal("prod-fleet", "maxpower", { "prod-fleet": "acme" });
		expect(reason).toBe(
			'namespace "prod-fleet" belongs to another organization',
		);
		expect(reason).not.toContain("acme");
	});

	it("matches the owner case-insensitively, so casing is not a bypass", () => {
		expect(authorizeNamespace("hanzo", "HANZO").decision).toBe("allow");
	});
});

describe("authorizeNamespace — fail closed", () => {
	it("REFUSES namespaces nobody owns", () => {
		for (const ns of ["kube-system", "default", "cert-manager", "hanzo-git"]) {
			expect(refusal(ns, "hanzo")).toContain("is neither this org's tenant");
		}
	});

	it("REFUSES the empty namespace", () => {
		expect(refusal("", "hanzo")).toBeTruthy();
	});

	it("has no wildcard or prefix escape", () => {
		expect(refusal("hanzo-anything", "hanzo")).toBeTruthy();
		expect(refusal("*", "hanzo")).toBeTruthy();
	});
});

describe("fleet ownership table is data", () => {
	it("ships fleet namespaces keyed to an owner, not a bare allowlist", () => {
		// Valued by org — this is what makes widening safe: adding a namespace
		// admits ONE org, not everyone.
		expect(DEFAULT_FLEET_NAMESPACE_OWNERS.hanzo).toBe("hanzo");
		expect(Object.values(DEFAULT_FLEET_NAMESPACE_OWNERS).every(Boolean)).toBe(
			true,
		);
	});

	it("parses an ownership spec from config", () => {
		expect(
			parseFleetNamespaceOwners("adnexus=adnexus, adnexus-dev=adnexus"),
		).toEqual({ adnexus: "adnexus", "adnexus-dev": "adnexus" });
	});

	it("throws loudly on a malformed entry rather than skipping it", () => {
		expect(() => parseFleetNamespaceOwners("hanzo")).toThrow(
			NamespaceOwnershipError,
		);
		expect(() => parseFleetNamespaceOwners("=hanzo")).toThrow(
			NamespaceOwnershipError,
		);
		expect(() => parseFleetNamespaceOwners("hanzo=")).toThrow(
			NamespaceOwnershipError,
		);
	});

	it("throws when one namespace is assigned to two orgs", () => {
		expect(() =>
			parseFleetNamespaceOwners("hanzo=hanzo,hanzo=maxpower"),
		).toThrow(/two organizations/);
	});

	it("env override replaces the table wholesale", () => {
		const owners = fleetNamespaceOwners({
			[FLEET_NAMESPACE_OWNERS_ENV]: "adnexus=adnexus",
		});
		expect(owners).toEqual({ adnexus: "adnexus" });
		// Replacement, not merge: the defaults are gone, so hanzo loses its fleet.
		expect(authorizeNamespace("hanzo", "hanzo", owners).decision).toBe(
			"refuse",
		);
		expect(authorizeNamespace("adnexus", "adnexus", owners).decision).toBe(
			"allow",
		);
	});

	it("falls back to the defaults when the env var is unset or blank", () => {
		expect(fleetNamespaceOwners({})).toBe(DEFAULT_FLEET_NAMESPACE_OWNERS);
		expect(fleetNamespaceOwners({ [FLEET_NAMESPACE_OWNERS_ENV]: "  " })).toBe(
			DEFAULT_FLEET_NAMESPACE_OWNERS,
		);
	});

	it("an env-configured org still cannot reach a namespace it does not own", () => {
		const owners = fleetNamespaceOwners({
			[FLEET_NAMESPACE_OWNERS_ENV]: "adnexus=adnexus,hanzo=hanzo",
		});
		expect(authorizeNamespace("hanzo", "adnexus", owners).decision).toBe(
			"refuse",
		);
	});
});
