/**
 * The embedded package catalog MUST stay byte-for-byte in sync with the console
 * seed (`console/platform-seed/packages.json`) — it is the platform-side source
 * `GET /v1/packages` serves. This test pins the 8 canonical packages + their
 * shape so a drift from the console seed is caught, and pins the service-template
 * deploy map + the existing-brand seed the resolver returns from data.
 */
import { describe, expect, it } from "vitest";
import {
	SEED_BRANDS,
	SEED_PACKAGES,
	SEED_SERVICE_TEMPLATES,
} from "@hanzo/platform/services/whitelabel/seed-data";
import {
	iamAppFor,
	scopeIamTenant,
} from "@hanzo/platform/services/whitelabel/iam-tenant";

describe("SEED_PACKAGES (the canonical catalog)", () => {
	it("has exactly the 8 console presets, by id", () => {
		expect(SEED_PACKAGES.map((p) => p.id).sort()).toEqual(
			[
				"ats",
				"bank",
				"bd",
				"console-admin",
				"dex",
				"paas",
				"sovereign-l1",
				"ta",
			].sort(),
		);
	});

	it("every package carries the full board shape", () => {
		for (const p of SEED_PACKAGES) {
			expect(typeof p.id).toBe("string");
			expect(typeof p.name).toBe("string");
			expect(Array.isArray(p.services)).toBe(true);
			expect(p.services.length).toBeGreaterThan(0);
			expect(p.brandTemplate).toHaveProperty("customBrand");
			expect(p.brandTemplate).toHaveProperty("hostPattern");
			expect(p.iamTemplate).toHaveProperty("ownIssuer");
			expect(p.iamTemplate).toHaveProperty("appPattern");
			expect(typeof p.domainPattern).toBe("string");
			expect(["free", "starter", "growth", "enterprise"]).toContain(p.plan);
		}
	});

	it("sovereign-l1 is the full stack (ats+bd+ta+chain) and flagged sovereign", () => {
		const sov = SEED_PACKAGES.find((p) => p.id === "sovereign-l1")!;
		expect(sov.sovereign).toBe(true);
		expect(sov.services).toEqual(
			expect.arrayContaining(["ats", "bd", "ta", "chain"]),
		);
	});
});

describe("SEED_SERVICE_TEMPLATES (the deploy-by-name map)", () => {
	it("marks iam/kms non-deployable (identity/secret scope, not workloads)", () => {
		const iam = SEED_SERVICE_TEMPLATES.find((t) => t.id === "iam")!;
		const kms = SEED_SERVICE_TEMPLATES.find((t) => t.id === "kms")!;
		expect(iam.deployable).toBe(false);
		expect(kms.deployable).toBe(false);
	});

	it("console-admin/paas have a real image and are deployable", () => {
		const con = SEED_SERVICE_TEMPLATES.find((t) => t.id === "console-admin")!;
		expect(con.image).toBe("ghcr.io/hanzoai/console");
		expect(con.deployable).toBe(true);
	});

	it("does NOT claim a template for dex/bank/ats/bd/ta/chain (honest — pending)", () => {
		const ids = new Set(SEED_SERVICE_TEMPLATES.map((t) => t.id));
		for (const s of ["dex", "bank", "ats", "bd", "ta", "chain"]) {
			expect(ids.has(s)).toBe(false);
		}
	});
});

describe("SEED_BRANDS (existing brands as tenant records)", () => {
	it("seeds hanzo/lux/zoo/pars with hosts + issuer + client id", () => {
		expect(SEED_BRANDS.map((b) => b.slug).sort()).toEqual([
			"hanzo",
			"lux",
			"pars",
			"zoo",
		]);
		for (const b of SEED_BRANDS) {
			expect(b.hosts.length).toBeGreaterThan(0);
			expect(b.iamUrl).toMatch(/^https:\/\//);
			expect(b.iamApp).toContain("-cloud");
		}
	});
});

describe("scopeIamTenant (honest IAM pending vs provisioned)", () => {
	it("records the deterministic <org>-<app> as pending with no admin token", async () => {
		const prevUrl = process.env.IAM_ADMIN_URL;
		const prevTok = process.env.IAM_ADMIN_TOKEN;
		delete process.env.IAM_ADMIN_URL;
		delete process.env.IAM_ADMIN_TOKEN;
		try {
			const res = await scopeIamTenant({
				slug: "acme",
				iamTemplate: { ownIssuer: true, appPattern: "{slug}-ats" },
			});
			expect(res.iamApp).toBe("acme-ats");
			expect(res.state).toBe("pending"); // honest — NOT faked provisioned
			expect(res.detail).toMatch(/IAM admin token/);
		} finally {
			if (prevUrl !== undefined) process.env.IAM_ADMIN_URL = prevUrl;
			if (prevTok !== undefined) process.env.IAM_ADMIN_TOKEN = prevTok;
		}
	});

	it("iamAppFor is the deterministic client id used by the scope", () => {
		expect(
			iamAppFor({ slug: "acme", iamTemplate: { ownIssuer: true, appPattern: "{slug}-bd" } }),
		).toBe("acme-bd");
	});
});
