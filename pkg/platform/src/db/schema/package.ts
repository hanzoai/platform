import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * package — the white-label package CATALOG.
 *
 * A "package" is a named preset a reseller can enable on one of its orgs: a set
 * of services to deploy, a brand template, an IAM tenant template, a domain
 * pattern, a billing plan, and whether it stands up a sovereign L1. Adding a
 * package later is a ROW here, never a code change (the CTO's "one and only one
 * way, data-driven, permanent" law).
 *
 * The catalog is served over `GET /v1/packages` (the console Tenants /
 * White-Label board reads it via `TenantsApi.packages()`); a grant of a package
 * to an org is recorded separately in `tenant_package`.
 *
 * SEED: `console/platform-seed/packages.json` (8 presets: console-admin, paas,
 * dex, bank, ats, bd, ta, sovereign-l1). The seed runs at boot
 * (`services/whitelabel/seed.ts`), upserting each row by `id` — editing the JSON
 * + a redeploy reseeds; the catalog is never a hardcoded console import.
 */

/**
 * Billing plan tiers a package maps to. Mirrors the seed's `plan` field and the
 * platform's existing `PlanTier` vocabulary (free/starter/growth/enterprise);
 * `starter`/`growth`/`enterprise` are the ones the presets use.
 */
export const packagePlanValues = [
	"free",
	"starter",
	"growth",
	"enterprise",
] as const;

export const packages = sqliteTable("package", {
	/** Stable catalog id, e.g. `console-admin`, `sovereign-l1`. */
	id: text("id").notNull().primaryKey(),
	/** Display name, e.g. `Console / Admin`. */
	name: text("name").notNull(),
	/** One-line description shown in the board. */
	description: text("description"),
	/**
	 * The service names this package deploys, e.g. `["console-admin","iam"]` or
	 * `["ats","bd","ta","chain","iam","kms","console-admin"]`. These are resolved
	 * against the deploy registry at provision time; a service with no deploy
	 * template is recorded pending (honest), never faked.
	 */
	services: text("services", { mode: "json" }).$type<string[]>().notNull(),
	/**
	 * Brand template — how the package brands the tenant. Shape mirrors the seed
	 * (`{customBrand, hostPattern}`); applied to `webServerSettings` at provision.
	 */
	brandTemplate: text("brandTemplate", { mode: "json" })
		.$type<{ customBrand: boolean; hostPattern: string }>()
		.notNull(),
	/**
	 * IAM template — how the package scopes identity. Shape mirrors the seed
	 * (`{ownIssuer, appPattern}`); `{slug}` expands to the org slug to form the
	 * `<org>-<app>` client id.
	 */
	iamTemplate: text("iamTemplate", { mode: "json" })
		.$type<{ ownIssuer: boolean; appPattern: string }>()
		.notNull(),
	/** Default host pattern for the package, e.g. `console.{slug}.hanzo.app`. */
	domainPattern: text("domainPattern").notNull(),
	/** Billing plan the package provisions the org onto. */
	plan: text("plan", { enum: packagePlanValues }).notNull().default("starter"),
	/** True for the full sovereign-L1 stack (ATS+BD+TA+chain). */
	sovereign: integer("sovereign", { mode: "boolean" }).notNull().default(false),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
});

const createSchema = createInsertSchema(packages, {
	id: z.string().min(1),
	name: z.string().min(1),
	services: z.array(z.string().min(1)).min(1),
	domainPattern: z.string().min(1),
});

/** Upsert shape for the seed loader + any future admin write. */
export const apiUpsertPackage = createSchema.pick({
	id: true,
	name: true,
	description: true,
	services: true,
	brandTemplate: true,
	iamTemplate: true,
	domainPattern: true,
	plan: true,
	sovereign: true,
});

export type Package = typeof packages.$inferSelect;
export type NewPackage = typeof packages.$inferInsert;
