/**
 * Which organization row a name resolves to.
 *
 * `services/org` holds the estate's half of the answer — that `hanzoai` and
 * `hanzo` are two names of one organization — and the database holds this
 * install's half: which row that organization IS. Every build's principal comes
 * out of that join, and a principal is what `authorizeNamespace` compares, so
 * the join is worth proving against a real schema rather than a mock that would
 * agree with whatever the query happened to say.
 *
 * Runs the REAL reader against a REAL on-disk SQLite built from the same drizzle
 * migrations the production image applies on boot.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Point the singleton db at a throwaway file BEFORE importing anything that
// opens it.
const dir = mkdtempSync(join(tmpdir(), "plat-org-"));
process.env.PLATFORM_DB_PATH = join(dir, "platform.db");
(process.env as Record<string, string>).NODE_ENV = "test";

const HANZO = "Yb5GFGDBEwcLsv2O8qWjS";
const LUX = "Lx7QpZm2NvKd8RtYeWc1A";

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

	const { db } = await import("@hanzo/platform/db");
	const { user, organization } = await import("@hanzo/platform/db/schema");
	db.insert(user)
		.values({
			id: "owner-user-org",
			email: "z@hanzo.ai",
			emailVerified: true,
			updatedAt: new Date(),
		} as never)
		.run();
	for (const [id, slug] of [
		[HANZO, "hanzo"],
		[LUX, "lux"],
	]) {
		db.insert(organization)
			.values({
				id,
				name: slug,
				slug,
				ownerId: "owner-user-org",
				createdAt: new Date(),
			} as never)
			.run();
	}
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("orgId", () => {
	it("resolves every name an organization owns to that organization's row", async () => {
		const { orgId } = await import("@hanzo/platform/services/org");
		for (const name of [
			"hanzo",
			"hanzoai",
			"hanzo-apps",
			"hanzoteam",
			"HanzoAI",
		]) {
			expect(await orgId(name), name).toBe(HANZO);
		}
		for (const name of ["lux", "luxfi", "LUXFI"]) {
			expect(await orgId(name), name).toBe(LUX);
		}
	});

	it("gives two organizations two rows", async () => {
		// A single principal for every repository is what makes a grant keyed by
		// namespace a grant to everyone; two names, two answers.
		const { orgId } = await import("@hanzo/platform/services/org");
		expect(await orgId("hanzoai")).not.toBe(await orgId("luxfi"));
	});

	it("resolves nothing for a name no organization owns", async () => {
		const { orgId } = await import("@hanzo/platform/services/org");
		expect(await orgId("evil")).toBeNull();
		expect(await orgId("grafana")).toBeNull();
		expect(await orgId("bootnode")).toBeNull();
	});

	it("resolves nothing for an organization with no row here", async () => {
		// `pars` is in the table and has no row here: a name with nobody behind
		// it is not a principal, and a build without one does not start.
		const { orgId } = await import("@hanzo/platform/services/org");
		expect(await orgId("parsdao")).toBeNull();
	});
});
