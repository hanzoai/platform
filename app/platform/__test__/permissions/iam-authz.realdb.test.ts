/**
 * Stage 2 end-to-end at the data layer (HIP-0111).
 *
 * This is the integration proof for the bug the task targets: after IAM-only
 * login the dashboard denied every per-org view ("You do not have permission
 * to view deployments") because `validateRequest` resolved an EMPTY
 * activeOrganizationId, so every member-scoped authz check failed closed.
 *
 * Unlike the unit test (which mocks the db), this runs the REAL code path
 * against a REAL on-disk SQLite database created from the SAME drizzle
 * migrations the production image applies on boot:
 *
 *   migrate(fresh sqlite) -> upsertUserFromIam(verifiedIdentity)
 *     -> resolvePermissions(ctx) / project-scope role
 *
 * It synthesizes only the ONE thing Stage 1 already proves works in prod —
 * the verified IAM identity (getServerSession's output) — and exercises
 * everything downstream for real. Asserts the before/after contract:
 *   - a fresh DB has NO org/member rows (reproduces the empty-org root cause);
 *   - after upsertUserFromIam an ordinary user has a populated active org and
 *     non-empty resolved permissions (service.read true) -> dashboard renders;
 *   - a global admin owns every org -> manage-all-orgs;
 *   - role maps to owner/admin so project.all returns the whole org (not the
 *     accessedProjects-filtered empty list a plain member would get).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerSession } from "@hanzo/iam/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Point the singleton db at a throwaway file BEFORE importing anything that
// opens it. NODE_ENV!=production so the module memoizes one connection.
const dir = mkdtempSync(join(tmpdir(), "plat-stage2-it-"));
const dbPath = join(dir, "platform.db");
process.env.PLATFORM_DB_PATH = dbPath;
// `@types/node` types `process.env.NODE_ENV` as read-only, so any direct
// assignment fails `tsc`. Write it through a mutable view. NODE_ENV must be
// != "production" so the db module memoizes a single connection (the dev
// branch) rather than opening eagerly at import.
(process.env as Record<string, string>).NODE_ENV = "test";

// Apply the real migrations to the fresh file using the same drizzle migrator
// the image runs (drizzle/ folder, resolved from app/platform cwd).
beforeAll(() => {
	// drizzle-kit-less: drive better-sqlite3 migrator directly via a tiny script
	// so the test is hermetic. Mirrors app/platform/server/db/migration.ts.
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
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

const identity = (over: Partial<ServerSession> = {}): ServerSession => ({
	userId: "hanzo/alice",
	owner: "hanzo",
	email: "alice@hanzo.ai",
	claims: {
		sub: "hanzo/alice",
		email: "alice@hanzo.ai",
		name: "Alice Example",
	} as ServerSession["claims"],
	...over,
});

describe("Stage 2 integration (real SQLite, real migrations)", () => {
	it("fresh DB has zero org/member rows — the empty-org root cause", async () => {
		const { db } = await import("@hanzo/platform/db");
		const orgs = await db.query.organization.findMany();
		const members = await db.query.member.findMany();
		expect(orgs).toHaveLength(0);
		expect(members).toHaveLength(0);
	});

	it("ordinary user: upsert yields a populated active org + non-empty permissions (dashboard renders)", async () => {
		const { upsertUserFromIam } = await import("@hanzo/platform/lib/iam");
		const { resolvePermissions } = await import(
			"@hanzo/platform/services/permission"
		);

		const session = await upsertUserFromIam(identity());

		// The fix: activeOrganizationId is no longer "" — this is what unblocks
		// every member-scoped authz check.
		expect(session.session.activeOrganizationId).not.toBe("");
		expect(session.user.role).toBe("owner");

		// resolvePermissions used to throw UNAUTHORIZED (no member row); now it
		// returns a populated grant map. service.read true == deployments view
		// is allowed (no more "You do not have permission to view deployments").
		const perms = await resolvePermissions({
			user: { id: session.session.userId },
			session: { activeOrganizationId: session.session.activeOrganizationId },
		});
		expect(perms.service.read).toBe(true);
		expect(perms.project.create).toBe(true);
		expect(perms.environment.read).toBe(true);
	});

	it("ordinary user maps to a privileged role -> project.all returns the whole org, not an empty accessedProjects filter", async () => {
		// project.all returns ALL org projects when role is owner/admin; a plain
		// member with empty accessedProjects would get []. Assert the role is the
		// privileged branch so the per-org PaaS board is populated, not denied.
		const { upsertUserFromIam } = await import("@hanzo/platform/lib/iam");
		const session = await upsertUserFromIam(identity());
		expect(["owner", "admin"]).toContain(session.user.role);
	});

	it("idempotent: a second upsert resolves the same org, no duplicate membership", async () => {
		const { upsertUserFromIam } = await import("@hanzo/platform/lib/iam");
		const { db } = await import("@hanzo/platform/db");
		const a = await upsertUserFromIam(identity());
		const b = await upsertUserFromIam(identity());
		expect(b.session.activeOrganizationId).toBe(a.session.activeOrganizationId);
		const { and, eq } = await import("drizzle-orm");
		const schema = await import("@hanzo/platform/db/schema");
		const members = await db.query.member.findMany({
			where: and(
				eq(schema.member.userId, "hanzo/alice"),
				eq(schema.member.organizationId, a.session.activeOrganizationId),
			),
		});
		expect(members).toHaveLength(1);
	});

	it("global admin owns EVERY org (manage all orgs)", async () => {
		const { upsertUserFromIam } = await import("@hanzo/platform/lib/iam");
		const { db } = await import("@hanzo/platform/db");

		// Seed two more orgs by upserting ordinary users from other IAM orgs.
		await upsertUserFromIam(
			identity({ userId: "zoo/bob", owner: "zoo", email: "bob@zoo.ngo" }),
		);
		await upsertUserFromIam(
			identity({ userId: "lux/carol", owner: "lux", email: "carol@lux.network" }),
		);

		// z@hanzo.ai is a global admin (matches the real IAM seed: isGlobalAdmin).
		const admin = await upsertUserFromIam(
			identity({
				userId: "hanzo/z",
				owner: "hanzo",
				email: "z@hanzo.ai",
				claims: {
					sub: "hanzo/z",
					email: "z@hanzo.ai",
					isGlobalAdmin: true,
				} as ServerSession["claims"],
			}),
		);
		expect(admin.user.role).toBe("admin"); // user.role admin -> Better Auth admin authz + haveRootAccess

		const allOrgs = await db.query.organization.findMany();
		const { and, eq } = await import("drizzle-orm");
		const schema = await import("@hanzo/platform/db/schema");
		for (const org of allOrgs) {
			const m = await db.query.member.findFirst({
				where: and(
					eq(schema.member.userId, "hanzo/z"),
					eq(schema.member.organizationId, org.id),
				),
			});
			expect(m, `global admin must be a member of org ${org.slug}`).toBeTruthy();
			expect(m?.role).toBe("owner");
		}
		// Sanity: there really are >=3 orgs now, so "every org" is non-trivial.
		expect(allOrgs.length).toBeGreaterThanOrEqual(3);
	});
});
