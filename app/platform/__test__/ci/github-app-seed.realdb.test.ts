/**
 * Regression proof for the GitHub App provider boot seed (off-PAT build path).
 *
 * `ensureGithubAppProvider()` -> `createGithub()` materializes the platform's
 * OWN `git_provider` + `github` rows from the KMS-synced `GITHUB_APP_*` env so
 * `scheduleBuilds` -> `resolveProvider` -> `findGithubByInstallationId` mints
 * App installation tokens instead of the rate-limited PAT.
 *
 * The live bug (paas logs): `createGithub` wrapped its two inserts in
 * `db.transaction(async (tx) => ...)`. better-sqlite3 (Hanzo Base) transactions
 * are SYNCHRONOUS — the async callback returns a promise, so better-sqlite3
 * throws `TypeError: Transaction function cannot return a promise` and ROLLS
 * BACK the `git_provider` insert; the orphaned async continuation then inserts
 * `github` referencing the vanished parent -> `FOREIGN KEY constraint failed`,
 * surfacing as an `unhandledRejection`. A synchronous transaction commits both
 * rows atomically and fixes all three symptoms.
 *
 * Runs the REAL code against a REAL on-disk SQLite built from the SAME drizzle
 * migrations the production image applies on boot (`foreign_keys = ON`) — not a
 * mock. Mirrors the iam-authz.realdb harness.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Point the singleton db at a throwaway file BEFORE importing anything that
// opens it. NODE_ENV != "production" so the module memoizes one connection.
const dir = mkdtempSync(join(tmpdir(), "plat-ghapp-seed-"));
const dbPath = join(dir, "platform.db");
process.env.PLATFORM_DB_PATH = dbPath;
(process.env as Record<string, string>).NODE_ENV = "test";

const ORG_ID = "ah7E1dvZROQai5LTnAGsr"; // DEFAULT_BUILD_ORG_ID (prod paas)
const OWNER_ID = "owner-user-ghapp-seed";
const INSTALLATION_ID = "62000701";
const APP_ID = "1164625";

beforeAll(async () => {
	// Apply the real migrations to the fresh file via the same drizzle migrator
	// the image runs (drizzle/ folder, resolved from app/platform cwd).
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

	// Seed the FK parents once: the owning user and org. (In prod these already
	// exist — the org-existence guard skips the seed otherwise.)
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
			createdAt: new Date(),
			ownerId: OWNER_ID,
		} as never)
		.run();
});

beforeEach(async () => {
	// Clean slate for the provider tables before each test (parents persist).
	const { db } = await import("@hanzo/platform/db");
	const { github, gitProvider } = await import("@hanzo/platform/db/schema");
	db.delete(github).run();
	db.delete(gitProvider).run();
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("createGithub (better-sqlite3 synchronous transaction)", () => {
	it("commits git_provider + github atomically — no TypeError, no FK error", async () => {
		const { createGithub } = await import("@hanzo/platform/services/github");
		const { db, eq } = await import("@hanzo/platform/db");
		const { github, gitProvider } = await import("@hanzo/platform/db/schema");

		const row = await createGithub(
			{
				name: "hanzoai",
				githubAppId: Number(APP_ID),
				githubInstallationId: INSTALLATION_ID,
				githubWebhookSecret: null,
			},
			ORG_ID,
			OWNER_ID,
		);

		// The github row came back (transaction committed, did not roll back).
		expect(row?.gitProviderId).toBeTruthy();
		expect(row?.githubInstallationId).toBe(INSTALLATION_ID);

		// Both parent + child rows persist and are joined correctly.
		const providers = db.select().from(gitProvider).all();
		const githubs = db.select().from(github).all();
		expect(providers).toHaveLength(1);
		expect(githubs).toHaveLength(1);
		expect(providers[0]?.organizationId).toBe(ORG_ID);
		expect(providers[0]?.userId).toBe(OWNER_ID);
		expect(githubs[0]?.gitProviderId).toBe(providers[0]?.gitProviderId);

		// The child FK actually resolves back to its parent.
		const joined = db.query.gitProvider.findFirst({
			where: eq(gitProvider.gitProviderId, providers[0]!.gitProviderId),
		});
		expect(joined).toBeTruthy();
	});
});

describe("ensureGithubAppProvider (boot seed)", () => {
	it("seeds the App provider from env, idempotently, resolvable by installation id", async () => {
		process.env.GITHUB_APP_ID = APP_ID;
		process.env.GITHUB_APP_PRIVATE_KEY =
			"-----BEGIN RSA PRIVATE KEY-----\nTESTKEY\n-----END RSA PRIVATE KEY-----";
		process.env.GITHUB_APP_INSTALLATION_ID = INSTALLATION_ID;
		process.env.GITHUB_APP_NAME = "hanzo-cloud-app";
		process.env.DEFAULT_BUILD_ORG_ID = ORG_ID;

		const { ensureGithubAppProvider, findGithubByInstallationId } =
			await import("@hanzo/platform/services/github");

		// First boot: seeds the row. Resolves to a value (never rejects).
		await expect(ensureGithubAppProvider()).resolves.toBeUndefined();

		const found = await findGithubByInstallationId(INSTALLATION_ID);
		expect(found?.githubInstallationId).toBe(INSTALLATION_ID);
		expect(found?.githubAppId).toBe(Number(APP_ID));
		// The provider carries the owning org — scheduleBuilds can resolve it.
		expect(found?.gitProvider?.organizationId).toBe(ORG_ID);

		// Second boot: idempotent no-op (existing provider found) — still one row.
		await expect(ensureGithubAppProvider()).resolves.toBeUndefined();
		const { db } = await import("@hanzo/platform/db");
		const { github } = await import("@hanzo/platform/db/schema");
		expect(db.select().from(github).all()).toHaveLength(1);
	});

	it("is a safe no-op when the App env is absent (dev box)", async () => {
		for (const k of [
			"GITHUB_APP_ID",
			"GITHUB_APP_PRIVATE_KEY",
			"GITHUB_APP_INSTALLATION_ID",
			"DEFAULT_BUILD_ORG_ID",
		]) {
			delete process.env[k];
		}
		const { ensureGithubAppProvider } = await import(
			"@hanzo/platform/services/github"
		);
		await expect(ensureGithubAppProvider()).resolves.toBeUndefined();
		const { db } = await import("@hanzo/platform/db");
		const { github } = await import("@hanzo/platform/db/schema");
		expect(db.select().from(github).all()).toHaveLength(0);
	});
});
