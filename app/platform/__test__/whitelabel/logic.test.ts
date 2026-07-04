/**
 * Pure white-label foundation logic — the host/pattern/plan/rollup/tree
 * decisions that back the reseller provisioning, unit-tested in isolation (no
 * db, no k8s). Pins the contracts the console board depends on.
 */
import { describe, expect, it } from "vitest";
import {
	expandPattern,
	ingressNameForHost,
	normalizeHost,
	type OrgNode,
	planTierOf,
	rollupStatus,
	subtreeIds,
} from "@hanzo/platform/services/whitelabel/logic";
import { iamAppFor } from "@hanzo/platform/services/whitelabel/iam-tenant";

describe("normalizeHost", () => {
	it("lowercases and strips protocol, path, and port", () => {
		expect(normalizeHost("HTTPS://Console.Acme.COM/path?x=1")).toBe(
			"console.acme.com",
		);
		expect(normalizeHost("http://acme.hanzo.app:3000")).toBe("acme.hanzo.app");
		expect(normalizeHost("  admin.acme.com  ")).toBe("admin.acme.com");
	});

	it("passes a bare host through unchanged (lowercased)", () => {
		expect(normalizeHost("dex.acme.exchange")).toBe("dex.acme.exchange");
	});
});

describe("ingressNameForHost", () => {
	it("is DNS-safe, prefixed, and capped at 63 chars", () => {
		expect(ingressNameForHost("console.acme.hanzo.app")).toBe(
			"wl-console-acme-hanzo-app",
		);
		const long = `${"a".repeat(80)}.hanzo.app`;
		expect(ingressNameForHost(long).length).toBeLessThanOrEqual(63);
		expect(ingressNameForHost("Bank.Acme.COM")).toBe("wl-bank-acme-com");
	});

	it("collapses invalid characters to hyphens", () => {
		expect(ingressNameForHost("a_b.c")).toBe("wl-a-b-c");
	});
});

describe("expandPattern", () => {
	it("expands every {slug} occurrence", () => {
		expect(expandPattern("console.{slug}.hanzo.app", "acme")).toBe(
			"console.acme.hanzo.app",
		);
		expect(expandPattern("{slug}.network", "lux")).toBe("lux.network");
		expect(expandPattern("{slug}-{slug}", "x")).toBe("x-x");
	});

	it("leaves a pattern with no {slug} unchanged", () => {
		expect(expandPattern("static.host", "acme")).toBe("static.host");
	});
});

describe("iamAppFor (the <org>-<app> client id)", () => {
	it("expands the appPattern to the client id", () => {
		expect(
			iamAppFor({
				slug: "acme",
				iamTemplate: { ownIssuer: true, appPattern: "{slug}-ats" },
			}),
		).toBe("acme-ats");
		expect(
			iamAppFor({
				slug: "lux",
				iamTemplate: { ownIssuer: false, appPattern: "{slug}-console" },
			}),
		).toBe("lux-console");
	});
});

describe("planTierOf", () => {
	it("maps package plans to platform quota tiers", () => {
		expect(planTierOf("enterprise")).toBe("enterprise");
		expect(planTierOf("growth")).toBe("pro");
		expect(planTierOf("starter")).toBe("starter");
		expect(planTierOf("free")).toBe("free");
		expect(planTierOf("pay-as-you-go")).toBe("free"); // unknown → free (safe)
	});
});

describe("rollupStatus", () => {
	it("is provisioning when there are no statuses yet", () => {
		expect(rollupStatus([])).toBe("provisioning");
	});

	it("is active only when every service provisioned", () => {
		expect(
			rollupStatus([
				{ service: "console-admin", state: "provisioned" },
				{ service: "iam", state: "provisioned" },
			]),
		).toBe("active");
	});

	it("is partial when some are pending (honest — never faked active)", () => {
		expect(
			rollupStatus([
				{ service: "console-admin", state: "provisioned" },
				{ service: "dex", state: "pending" },
			]),
		).toBe("partial");
	});

	it("is failed when any service failed (failure dominates)", () => {
		expect(
			rollupStatus([
				{ service: "console-admin", state: "provisioned" },
				{ service: "dex", state: "pending" },
				{ service: "ats", state: "failed" },
			]),
		).toBe("failed");
	});
});

describe("subtreeIds (reseller org tree)", () => {
	const orgs: OrgNode[] = [
		{ id: "hanzo", name: "Hanzo", slug: "hanzo", parentOrgId: null },
		{ id: "reseller", name: "Reseller", slug: "r", parentOrgId: null },
		{ id: "sub1", name: "Sub1", slug: "s1", parentOrgId: "reseller" },
		{ id: "sub2", name: "Sub2", slug: "s2", parentOrgId: "reseller" },
		{ id: "grandchild", name: "GC", slug: "gc", parentOrgId: "sub1" },
		{ id: "other", name: "Other", slug: "o", parentOrgId: null },
	];

	it("includes the root and every transitive descendant", () => {
		const ids = subtreeIds(orgs, "reseller");
		expect(ids).toEqual(
			new Set(["reseller", "sub1", "sub2", "grandchild"]),
		);
	});

	it("a leaf's subtree is just itself", () => {
		expect(subtreeIds(orgs, "grandchild")).toEqual(new Set(["grandchild"]));
	});

	it("does NOT include siblings or unrelated orgs (reseller isolation)", () => {
		const ids = subtreeIds(orgs, "reseller");
		expect(ids.has("hanzo")).toBe(false);
		expect(ids.has("other")).toBe(false);
	});

	it("is cycle-safe (a parent loop does not hang)", () => {
		const cyclic: OrgNode[] = [
			{ id: "a", name: "A", slug: "a", parentOrgId: "b" },
			{ id: "b", name: "B", slug: "b", parentOrgId: "a" },
		];
		expect(subtreeIds(cyclic, "a")).toEqual(new Set(["a", "b"]));
	});
});
