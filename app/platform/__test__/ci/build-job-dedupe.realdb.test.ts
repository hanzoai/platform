/**
 * One commit, one target, one image — one row, however many deliveries arrive.
 *
 * A re-delivered webhook and a retried enqueue reach `createBuildJob` at the
 * same time, and a read-then-insert lets both reads miss and both inserts land.
 * Two rows means two BuildKit Jobs building the same commit to the same tag: the
 * digests agree and the pin is idempotent, so nothing incorrect is published —
 * it is a second cluster build nobody asked for, and a second row the board has
 * to explain.
 *
 * The key is stated to the DATABASE, so concurrency cannot beat it, and the
 * writer returns the row that won rather than failing the caller.
 *
 * Runs the REAL writer against a REAL on-disk SQLite built from the same drizzle
 * migrations the production image applies on boot.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Point the singleton db at a throwaway file BEFORE importing anything that
// opens it.
const dir = mkdtempSync(join(tmpdir(), "plat-buildjob-dedupe-"));
const dbPath = join(dir, "platform.db");
process.env.PLATFORM_DB_PATH = dbPath;
(process.env as Record<string, string>).NODE_ENV = "test";

const ORG_ID = "Yb5GFGDBEwcLsv2O8qWjS";
const OWNER_ID = "owner-user-buildjob-dedupe";
const SHA = "0".repeat(40);

const row = {
	repo: "hanzoai/kms",
	sha: SHA,
	ref: "refs/heads/main",
	branch: "main",
	target: "linux/amd64",
	runnerPool: "hanzo-build-linux-amd64",
	image: "ghcr.io/hanzoai/kms:v1.0.0",
	organizationId: ORG_ID,
};

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
			id: OWNER_ID,
			email: "z@hanzo.ai",
			emailVerified: true,
			updatedAt: new Date(),
		} as never)
		.run();
	db.insert(organization)
		.values({
			id: ORG_ID,
			name: "hanzo",
			slug: "hanzo",
			ownerId: OWNER_ID,
			createdAt: new Date(),
		} as never)
		.run();
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("createBuildJob", () => {
	it("gives concurrent deliveries of one build one row", async () => {
		const { createBuildJob } = await import(
			"@hanzo/platform/services/ci/build-job"
		);
		const { db } = await import("@hanzo/platform/db");
		const { buildJob } = await import("@hanzo/platform/db/schema");

		const both = await Promise.all([
			createBuildJob(row),
			createBuildJob(row),
			createBuildJob(row),
		]);

		const all = await db.select().from(buildJob);
		expect(all).toHaveLength(1);
		// Every caller is handed the row that exists, not a failure and not a
		// second identity for the same build.
		expect(new Set(both.map((b) => b.buildJobId)).size).toBe(1);
		expect(both[0]?.buildJobId).toBe(all[0]?.buildJobId);
	});

	it("keeps a second image of the same commit a second build", async () => {
		const { createBuildJob } = await import(
			"@hanzo/platform/services/ci/build-job"
		);
		const other = await createBuildJob({
			...row,
			image: "ghcr.io/hanzoai/kms-operator:v1.0.0",
		});
		const first = await createBuildJob(row);
		expect(other.buildJobId).not.toBe(first.buildJobId);
	});
});
