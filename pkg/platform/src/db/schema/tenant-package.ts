import { relations } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";
import { packages } from "./package";

/**
 * tenant_package — the record of a package GRANTED to an org.
 *
 * `provisionPackage(org, pkg)` (the composite "enable a package" action) writes
 * one row here per (org, package): it composes the existing platform services —
 * deploy the package's services, bind its domain, scope its IAM tenant, apply
 * its brand, set its billing plan — and records the outcome. Idempotent: a
 * second provision of the same (org, package) updates the same row.
 *
 * HONEST by construction: `serviceStatuses` records, per service in the
 * package, whether it was actually `provisioned`, is `pending` (no deploy
 * template yet), or `failed` — the board reads real provisioning state, never a
 * fabricated "provisioned". `status` rolls those up.
 *
 * DELETE = deprovision (the row is removed; the underlying CRs/domain are torn
 * down by `deprovisionPackage`).
 */

/** Rolled-up grant status. */
export const tenantPackageStatusValues = [
	/** every service in the package provisioned. */
	"active",
	/** the grant is recorded and some services provisioned, others pending. */
	"partial",
	/** provisioning is in flight. */
	"provisioning",
	/** a hard failure occurred during provisioning. */
	"failed",
] as const;

/** Per-service provisioning outcome inside a grant. */
export const packageServiceStateValues = [
	"provisioned",
	"pending",
	"failed",
] as const;

export interface PackageServiceStatus {
	/** The service name from the package's `services` list. */
	service: string;
	state: (typeof packageServiceStateValues)[number];
	/** What was provisioned (e.g. CR name) or why it is pending/failed. */
	detail?: string;
	/** Build job id when a build was enqueued for this service. */
	buildJobId?: string;
}

export const tenantPackages = sqliteTable(
	"tenant_package",
	{
		id: text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		/** Owning org (the tenant the package is enabled on). */
		organizationId: text("organizationId")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** The catalog package this grant is of. */
		packageId: text("packageId")
			.notNull()
			.references(() => packages.id, { onDelete: "cascade" }),
		status: text("status", { enum: tenantPackageStatusValues })
			.notNull()
			.default("provisioning"),
		/** Per-service provisioning outcomes (honest state — never faked). */
		serviceStatuses: text("serviceStatuses", { mode: "json" })
			.$type<PackageServiceStatus[]>()
			.notNull()
			.$defaultFn(() => []),
		/** The host the package's domain was bound to (from `domainPattern`). */
		host: text("host"),
		/** The `<org>-<app>` IAM client id scoped for this package, if any. */
		iamApp: text("iamApp"),
		/** The billing plan the org was set onto for this package. */
		plan: text("plan"),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => ({
		/** One grant per (org, package) — provision is idempotent on this tuple. */
		tenantPackageUnique: uniqueIndex("tenant_package_unique").on(
			table.organizationId,
			table.packageId,
		),
	}),
);

export const tenantPackagesRelations = relations(tenantPackages, ({ one }) => ({
	organization: one(organization, {
		fields: [tenantPackages.organizationId],
		references: [organization.id],
	}),
	package: one(packages, {
		fields: [tenantPackages.packageId],
		references: [packages.id],
	}),
}));

const createSchema = createInsertSchema(tenantPackages, {
	organizationId: z.string().min(1),
	packageId: z.string().min(1),
});

export const apiProvisionPackage = z.object({
	organizationId: z.string().min(1),
	packageId: z.string().min(1),
	/** Optional slug override for the host/IAM patterns (defaults to org slug). */
	slug: z.string().min(1).optional(),
});

export type TenantPackage = typeof tenantPackages.$inferSelect;
export type NewTenantPackage = typeof tenantPackages.$inferInsert;
