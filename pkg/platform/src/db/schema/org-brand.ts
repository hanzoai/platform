import { relations } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organization } from "./account";

/**
 * org_brand — PER-ORG white-label brand config.
 *
 * The Dokploy `webServerSettings` table is a GLOBAL singleton (one branding
 * config for the whole install, no `organizationId`). A reseller platform needs
 * brand PER org, so this is the per-org store: one row per org carrying the
 * brand a `GET /v1/brand?host=` read resolves and a `provisionPackage` /
 * `PUT /v1/org/{org}/brand` write applies.
 *
 * It intentionally mirrors the shape the console's hardcoded `BRANDS` map holds
 * (`brandName`, `iamUrl`, `iamApp`, `logoUrl`, `faviconUrl`, `accentColor`) so
 * the brand resolver can return everything the console needs FROM DATA — killing
 * the hardcoded map. One row per org (`organizationId` is unique).
 */
export const orgBrands = sqliteTable("org_brand", {
	id: text("id")
		.notNull()
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	/** The org this brand belongs to (one brand per org). */
	organizationId: text("organizationId")
		.notNull()
		.unique()
		.references(() => organization.id, { onDelete: "cascade" }),
	/** Wordmark, e.g. `Lux Cloud`. Falls back to the org name. */
	brandName: text("brandName"),
	/** OIDC issuer this org's hosts authenticate against, e.g. `https://lux.id`. */
	iamUrl: text("iamUrl"),
	/** IAM org name (the `owner` claim), e.g. `lux`. Falls back to the org slug. */
	iamOrgName: text("iamOrgName"),
	/** `<org>-<app>` IAM client id, e.g. `lux-cloud`. */
	iamApp: text("iamApp"),
	/** Brand logo URL. */
	logoUrl: text("logoUrl"),
	/** Favicon URL. */
	faviconUrl: text("faviconUrl"),
	/** Theme accent colour (hex), e.g. `#615CED`. */
	accentColor: text("accentColor"),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
});

export const orgBrandsRelations = relations(orgBrands, ({ one }) => ({
	organization: one(organization, {
		fields: [orgBrands.organizationId],
		references: [organization.id],
	}),
}));

const createSchema = createInsertSchema(orgBrands, {
	organizationId: z.string().min(1),
});

/** Brand write shape (mirrors the board's `writeBrand` / `BrandInput`). */
export const apiWriteBrand = z.object({
	brandName: z.string().optional().nullable(),
	iamUrl: z.string().optional().nullable(),
	iamOrgName: z.string().optional().nullable(),
	iamApp: z.string().optional().nullable(),
	logoUrl: z.string().optional().nullable(),
	faviconUrl: z.string().optional().nullable(),
	accentColor: z.string().optional().nullable(),
	/** Board sends `appName`; treated as an alias for `brandName`. */
	appName: z.string().optional().nullable(),
	/** Board may send `host`; the host binding lives in whitelabel_domain, not here. */
	host: z.string().optional().nullable(),
});

export type OrgBrand = typeof orgBrands.$inferSelect;
export type NewOrgBrand = typeof orgBrands.$inferInsert;
