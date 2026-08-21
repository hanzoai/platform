/**
 * An installation id names ONE App row.
 *
 * The id is what a GitHub delivery identifies itself by, and two readers look
 * it up independently — the route, to find the secret the HMAC is checked
 * against, and the scheduler, to find the organization and the credential. Both
 * take the FIRST row an unordered query returns. With two rows carrying one id
 * they can return different rows, and then the delivery is verified against one
 * tenant's secret and read with another's credential.
 *
 * Even where they agree it is not benign: a second row carrying a live
 * installation's id sends that tenant's genuine deliveries to the wrong secret,
 * every HMAC fails, and the lane goes quiet with nothing to see.
 *
 * So the database holds the property rather than the readers checking for it.
 * NULL is exempt, and has to be: an App exists between `gh_init` and
 * `gh_setup` with no installation at all, and SQLite counts those as distinct.
 *
 * Runs against a REAL on-disk SQLite built from the same drizzle migrations the
 * production image applies on boot.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "plat-install-id-"));
process.env.PLATFORM_DB_PATH = join(dir, "platform.db");
(process.env as Record<string, string>).NODE_ENV = "test";

const OWNER_ID = "owner-user-install-id";
const HANZO = "org-hanzo-install-id";
const LUX = "org-lux-install-id";
const INSTALLATION = "62000701";

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
	for (const [id, name] of [
		[HANZO, "hanzo"],
		[LUX, "lux"],
	] as const) {
		db.insert(organization)
			.values({ id, name, createdAt: new Date(), ownerId: OWNER_ID } as never)
			.run();
	}
});

beforeEach(async () => {
	const { db } = await import("@hanzo/platform/db");
	const { github, gitProvider } = await import("@hanzo/platform/db/schema");
	db.delete(github).run();
	db.delete(gitProvider).run();
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

async function app(organizationId: string, installationId: string | null) {
	const { createGithub } = await import("@hanzo/platform/services/github");
	return createGithub(
		{
			name: `app-${organizationId}`,
			githubAppId: 1164625,
			githubInstallationId: installationId ?? undefined,
			githubWebhookSecret: `secret-${organizationId}`,
		},
		organizationId,
		OWNER_ID,
	);
}

describe("the installation id an App row carries", () => {
	it("cannot be claimed by a second App", async () => {
		await app(HANZO, INSTALLATION);
		await expect(app(LUX, INSTALLATION)).rejects.toThrow(/UNIQUE|constraint/i);

		const { db } = await import("@hanzo/platform/db");
		const { github } = await import("@hanzo/platform/db/schema");
		const rows = db.select().from(github).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.githubWebhookSecret).toBe(`secret-${HANZO}`);
	});

	it("resolves to one row, so both readers read the same one", async () => {
		await app(HANZO, INSTALLATION);
		const { db, eq } = await import("@hanzo/platform/db");
		const { github } = await import("@hanzo/platform/db/schema");
		const { findGithubByInstallationId } = await import(
			"@hanzo/platform/services/github"
		);

		// The route's lookup and the scheduler's lookup, side by side.
		const plain = await db.query.github.findFirst({
			where: eq(github.githubInstallationId, INSTALLATION),
		});
		const relational = await findGithubByInstallationId(INSTALLATION);
		expect(plain?.githubId).toBe(relational?.githubId);
	});

	it("leaves an App that is not installed yet alone — several may have none", async () => {
		await app(HANZO, null);
		await app(LUX, null);
		const { db } = await import("@hanzo/platform/db");
		const { github } = await import("@hanzo/platform/db/schema");
		expect(db.select().from(github).all()).toHaveLength(2);
	});
});
