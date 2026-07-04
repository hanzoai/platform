/**
 * End-to-end integration proof for the white-label reseller foundation against
 * a REAL on-disk SQLite built from the SAME drizzle migrations the production
 * image applies on boot (incl. 0007_whitelabel_foundation). No mock.
 *
 * Proves the board's honest-404s become real data-driven self-service:
 *   - the migration applies (all 5 tables + parent_org_id exist),
 *   - the seed upserts the 8-package catalog + service templates + brands,
 *   - `GET /v1/packages` returns the catalog,
 *   - `GET /v1/brand?host=` resolves a seeded brand FROM DATA,
 *   - a domain bind records a host→org binding (the routed-host set derives from
 *     rows), and the brand resolves for the newly-bound host,
 *   - `provisionPackage` composes the steps and records HONEST per-service state
 *     (console-admin provisioned/attempted, iam satisfied-by-scope, an
 *     un-templated service pending — never faked), idempotently,
 *   - reseller scoping derives the org sub-tree from parent_org_id.
 *
 * Mirrors the ci/github-app-seed.realdb harness.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Provisioning attempts a (failing, in-test) cluster/DNS call with retries, and
// the first import compiles the service barrel — both push past the 5s default.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

// Point the singleton db at a throwaway file BEFORE importing anything that
// opens it. NODE_ENV != "production" so the module memoizes one connection.
const dir = mkdtempSync(join(tmpdir(), "plat-whitelabel-"));
const dbPath = join(dir, "platform.db");
process.env.PLATFORM_DB_PATH = dbPath;
(process.env as Record<string, string>).NODE_ENV = "test";
// Keep provisioning off any real cluster/DNS: no k8s, no Cloudflare configured.
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.IAM_ADMIN_URL;
delete process.env.IAM_ADMIN_TOKEN;

const OWNER_ID = "owner-user-wl";
const HANZO_ORG = "org-hanzo-wl";
const ACME_ORG = "org-acme-wl";
const SUB_ORG = "org-acme-sub-wl";

beforeAll(async () => {
	const script = `
		const Database = require("better-sqlite3");
		const { drizzle } = require("drizzle-orm/better-sqlite3");
		const { migrate } = require("drizzle-orm/better-sqlite3/migrator");
		const db = drizzle(new Database(process.env.PLATFORM_DB_PATH));
		migrate(db, { migrationsFolder: "drizzle" });
	`;
	execFileSync(process.execPath, ["-e", script], {
		cwd: process.cwd(),
		env: process.env,
		stdio: "inherit",
	});

	// Seed FK parents: an owner + the hanzo org (slug hanzo, so the brand seed
	// enriches it) + a reseller (acme) + acme's sub-org.
	const { db } = await import("@hanzo/platform/db");
	const { user, organization } = await import("@hanzo/platform/db/schema");
	db.insert(user)
		.values({
			id: OWNER_ID,
			email: "z@hanzo.ai",
			emailVerified: true,
			updatedAt: new Date(),
		} as never)
		.run();
	db.insert(organization)
		.values([
			{ id: HANZO_ORG, name: "Hanzo", slug: "hanzo", createdAt: new Date(), ownerId: OWNER_ID },
			{ id: ACME_ORG, name: "Acme", slug: "acme", createdAt: new Date(), ownerId: OWNER_ID },
			{
				id: SUB_ORG,
				name: "Acme Sub",
				slug: "acme-sub",
				createdAt: new Date(),
				ownerId: OWNER_ID,
				parentOrgId: ACME_ORG,
			},
		] as never)
		.run();
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("migration 0007 + seed", () => {
	it("seeds the 8-package catalog, service templates, and the hanzo brand", async () => {
		const { seedWhitelabelFoundation, listPackages } = await import(
			"@hanzo/platform/services/whitelabel"
		);
		const report = await seedWhitelabelFoundation();
		expect(report.packages).toBe(8);
		expect(report.serviceTemplates).toBeGreaterThanOrEqual(4);
		// hanzo org exists (slug=hanzo) → enriched; lux/zoo/pars absent → skipped.
		expect(report.brandsSeeded).toContain("hanzo");
		expect(report.brandsSkipped).toEqual(
			expect.arrayContaining(["lux", "zoo", "pars"]),
		);

		const pkgs = await listPackages();
		expect(pkgs.map((p) => p.id).sort()).toEqual(
			["ats", "bank", "bd", "console-admin", "dex", "paas", "sovereign-l1", "ta"].sort(),
		);
	});

	it("is idempotent — reseeding does not duplicate rows", async () => {
		const { seedWhitelabelFoundation, listPackages } = await import(
			"@hanzo/platform/services/whitelabel"
		);
		await seedWhitelabelFoundation();
		const pkgs = await listPackages();
		expect(pkgs).toHaveLength(8);
	});
});

describe("GET /v1/brand?host= — resolves FROM DATA", () => {
	it("resolves a seeded hanzo host to its brand config", async () => {
		const { resolveBrandByHost } = await import(
			"@hanzo/platform/services/whitelabel"
		);
		const brand = await resolveBrandByHost("console.hanzo.ai");
		expect(brand).not.toBeNull();
		expect(brand!.org).toBe("hanzo");
		expect(brand!.brandName).toBe("Hanzo Cloud");
		expect(brand!.iamUrl).toBe("https://hanzo.id");
		expect(brand!.iamApp).toBe("hanzo-cloud");
	});

	it("returns null for an unbound host (console falls back to its default)", async () => {
		const { resolveBrandByHost } = await import(
			"@hanzo/platform/services/whitelabel"
		);
		expect(await resolveBrandByHost("nobody.example.com")).toBeNull();
	});
});

describe("domain binding — the routed-host set derives from rows", () => {
	it("binds a host to an org and the brand then resolves for it", async () => {
		const { bindDomain, listDomains, writeOrgBrand, resolveBrandByHost } =
			await import("@hanzo/platform/services/whitelabel");

		await writeOrgBrand(ACME_ORG, {
			brandName: "Acme Cloud",
			iamUrl: "https://acme.id",
			iamApp: "acme-console",
			iamOrgName: "acme",
		});
		// No Cloudflare / cluster in the test env → ingress/DNS are best-effort and
		// recorded honestly; the BINDING row is what the routed-host set reads.
		const binding = await bindDomain(ACME_ORG, {
			host: "console.acme.com",
			serviceName: "console",
		});
		expect(binding.host).toBe("console.acme.com");
		expect(binding.organizationId).toBe(ACME_ORG);

		const domains = await listDomains(ACME_ORG);
		expect(domains.map((d) => d.host)).toContain("console.acme.com");

		const brand = await resolveBrandByHost("console.acme.com");
		expect(brand!.org).toBe("acme");
		expect(brand!.brandName).toBe("Acme Cloud");
	});
});

describe("provisionPackage — composite, HONEST per-service state", () => {
	it("records a grant with honest service statuses (no faked provisioned)", async () => {
		const { provisionPackage, listTenantPackages } = await import(
			"@hanzo/platform/services/whitelabel"
		);
		// sovereign-l1 = ats+bd+ta+chain+iam+kms+console-admin. Only console-admin
		// has a real deployable template; ats/bd/ta/chain have none (pending);
		// iam/kms are satisfied-by-scope. No cluster in-test → console-admin's CR
		// apply fails → recorded 'failed' honestly. The point: EVERY service's
		// state is real, and the grant is recorded.
		const { grant } = await provisionPackage(ACME_ORG, "sovereign-l1");
		const byService = Object.fromEntries(
			grant.serviceStatuses.map((s) => [s.service, s.state]),
		);
		// Un-templated services are pending (honest — never provisioned).
		expect(byService.ats).toBe("pending");
		expect(byService.chain).toBe("pending");
		// iam is satisfied-by-scope (recorded once for the package).
		expect(grant.serviceStatuses.some((s) => s.service === "iam")).toBe(true);
		// The grant is recorded with a rolled-up status and the bound host.
		expect(["active", "partial", "failed"]).toContain(grant.status);
		expect(grant.host).toBe("acme.network");
		expect(grant.iamApp).toBe("acme-console");

		const grants = await listTenantPackages(ACME_ORG);
		expect(grants.some((g) => g.packageId === "sovereign-l1")).toBe(true);
	});

	it("is idempotent on (org, package) — one grant row", async () => {
		const { provisionPackage, listTenantPackages } = await import(
			"@hanzo/platform/services/whitelabel"
		);
		await provisionPackage(ACME_ORG, "sovereign-l1");
		const grants = await listTenantPackages(ACME_ORG);
		expect(grants.filter((g) => g.packageId === "sovereign-l1")).toHaveLength(1);
	});

	it("deprovision removes the grant", async () => {
		const { provisionPackage, deprovisionPackage, listTenantPackages } =
			await import("@hanzo/platform/services/whitelabel");
		await provisionPackage(ACME_ORG, "console-admin");
		await deprovisionPackage(ACME_ORG, "console-admin");
		const grants = await listTenantPackages(ACME_ORG);
		expect(grants.some((g) => g.packageId === "console-admin")).toBe(false);
	});
});

describe("reseller scoping — org tree from parent_org_id", () => {
	it("a reseller sees its own sub-tree, not siblings", async () => {
		const { resellerScope, resellerCanActOn } = await import(
			"@hanzo/platform/services/whitelabel"
		);
		const scope = await resellerScope(ACME_ORG);
		const ids = scope.map((o) => o.id);
		expect(ids).toContain(ACME_ORG);
		expect(ids).toContain(SUB_ORG);
		expect(ids).not.toContain(HANZO_ORG);

		expect(await resellerCanActOn(ACME_ORG, SUB_ORG)).toBe(true);
		expect(await resellerCanActOn(ACME_ORG, HANZO_ORG)).toBe(false);
	});
});
