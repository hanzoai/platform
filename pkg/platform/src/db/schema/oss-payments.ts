/**
 * OSS Author Payment Tracking Schema
 *
 * Tracks open-source dependencies, attributes contributions to authors,
 * and manages payment distribution from compute revenue.
 */

import { relations, sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	numeric,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organization } from "./account";
import { walletTransactions } from "./wallet";

// Enums
export const ecosystemEnum = pgEnum("oss_ecosystem", [
	"npm",
	"cargo",
	"pypi",
	"go",
]);

export const paymentTypeEnum = pgEnum("oss_payment_type", [
	"github_sponsors",
	"open_collective",
	"ethereum",
	"bitcoin",
	"lux",
	"stripe",
]);

export const distributionStatusEnum = pgEnum("oss_distribution_status", [
	"pending",
	"processing",
	"completed",
	"failed",
]);

export const contributorRoleEnum = pgEnum("oss_contributor_role", [
	"primary",
	"maintainer",
	"contributor",
]);

// ============================================================================
// OSS Authors
// ============================================================================

export const ossAuthors = pgTable(
	"oss_authors",
	{
		authorId: uuid("author_id").defaultRandom().primaryKey(),
		name: text("name").notNull(),
		email: text("email"),
		githubUsername: text("github_username").unique(),
		verified: boolean("verified").notNull().default(false),
		verificationDate: timestamp("verification_date", { withTimezone: true }),
		lastActive: timestamp("last_active", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => ({
		githubIdx: index("idx_oss_authors_github").on(table.githubUsername),
		emailIdx: index("idx_oss_authors_email").on(table.email),
	}),
);

export const ossPaymentAddresses = pgTable(
	"oss_payment_addresses",
	{
		addressId: uuid("address_id").defaultRandom().primaryKey(),
		authorId: uuid("author_id")
			.notNull()
			.references(() => ossAuthors.authorId, { onDelete: "cascade" }),
		addressType: paymentTypeEnum("address_type").notNull(),
		address: text("address").notNull(),
		verified: boolean("verified").notNull().default(false),
		preferred: boolean("preferred").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => ({
		authorIdx: index("idx_oss_payment_addr_author").on(table.authorId),
		uniqueAddr: uniqueIndex("idx_oss_payment_addr_unique").on(
			table.authorId,
			table.addressType,
			table.address,
		),
	}),
);

// ============================================================================
// OSS Packages
// ============================================================================

export const ossPackages = pgTable(
	"oss_packages",
	{
		packageId: uuid("package_id").defaultRandom().primaryKey(),
		name: text("name").notNull(),
		ecosystem: ecosystemEnum("ecosystem").notNull(),
		version: text("version"),
		repositoryUrl: text("repository_url"),
		homepageUrl: text("homepage_url"),
		license: text("license"),
		description: text("description"),
		lastFetched: timestamp("last_fetched", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => ({
		ecosystemIdx: index("idx_oss_packages_ecosystem").on(table.ecosystem),
		nameEcosystemIdx: uniqueIndex("idx_oss_packages_name_ecosystem").on(
			table.name,
			table.ecosystem,
		),
	}),
);

export const ossPackageAuthors = pgTable(
	"oss_package_authors",
	{
		packageId: uuid("package_id")
			.notNull()
			.references(() => ossPackages.packageId, { onDelete: "cascade" }),
		authorId: uuid("author_id")
			.notNull()
			.references(() => ossAuthors.authorId, { onDelete: "cascade" }),
		sharePercentage: numeric("share_percentage", { precision: 5, scale: 4 }).notNull(),
		role: contributorRoleEnum("role").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => ({
		pk: uniqueIndex("idx_oss_pkg_authors_pk").on(table.packageId, table.authorId),
		packageIdx: index("idx_oss_pkg_authors_package").on(table.packageId),
		authorIdx: index("idx_oss_pkg_authors_author").on(table.authorId),
	}),
);

// ============================================================================
// OSS Projects (tracked projects using OSS)
// ============================================================================

export const ossProjects = pgTable(
	"oss_projects",
	{
		ossProjectId: uuid("oss_project_id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		repositoryUrl: text("repository_url"),
		lastScan: timestamp("last_scan", { withTimezone: true }),
		monthlyBudget: numeric("monthly_budget", { precision: 12, scale: 2 }),
		autoDistribute: boolean("auto_distribute").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => ({
		orgIdx: index("idx_oss_projects_org").on(table.organizationId),
	}),
);

export const ossProjectDependencies = pgTable(
	"oss_project_dependencies",
	{
		ossProjectId: uuid("oss_project_id")
			.notNull()
			.references(() => ossProjects.ossProjectId, { onDelete: "cascade" }),
		packageId: uuid("package_id")
			.notNull()
			.references(() => ossPackages.packageId, { onDelete: "cascade" }),
		version: text("version"),
		isDirect: boolean("is_direct").notNull(),
		depth: integer("depth").notNull().default(0),
		usageCount: integer("usage_count").notNull().default(0),
		firstAdded: timestamp("first_added", { withTimezone: true }).notNull().defaultNow(),
		lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => ({
		pk: uniqueIndex("idx_oss_proj_deps_pk").on(table.ossProjectId, table.packageId),
		projectIdx: index("idx_oss_proj_deps_project").on(table.ossProjectId),
		packageIdx: index("idx_oss_proj_deps_package").on(table.packageId),
	}),
);

// ============================================================================
// Usage Attribution (compute job -> OSS packages used)
// ============================================================================

export const ossUsageAttributions = pgTable(
	"oss_usage_attributions",
	{
		attributionId: uuid("attribution_id").defaultRandom().primaryKey(),
		ossProjectId: uuid("oss_project_id")
			.notNull()
			.references(() => ossProjects.ossProjectId, { onDelete: "cascade" }),
		packageId: uuid("package_id")
			.notNull()
			.references(() => ossPackages.packageId, { onDelete: "cascade" }),
		computeJobId: text("compute_job_id"),
		computeCost: numeric("compute_cost", { precision: 12, scale: 6 }).notNull(),
		attributedShare: numeric("attributed_share", { precision: 8, scale: 6 }).notNull(),
		attributedAmount: numeric("attributed_amount", { precision: 12, scale: 6 }).notNull(),
		periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
		periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
		processed: boolean("processed").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => ({
		projectIdx: index("idx_oss_usage_attr_project").on(table.ossProjectId),
		packageIdx: index("idx_oss_usage_attr_package").on(table.packageId),
		periodIdx: index("idx_oss_usage_attr_period").on(table.periodStart, table.periodEnd),
		unprocessedIdx: index("idx_oss_usage_attr_unprocessed").on(table.processed),
	}),
);

// ============================================================================
// Distributions and Payments
// ============================================================================

export const ossDistributions = pgTable(
	"oss_distributions",
	{
		distributionId: uuid("distribution_id").defaultRandom().primaryKey(),
		ossProjectId: uuid("oss_project_id")
			.notNull()
			.references(() => ossProjects.ossProjectId, { onDelete: "cascade" }),
		totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
		currency: text("currency").notNull().default("USD"),
		periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
		periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
		status: distributionStatusEnum("status").notNull().default("pending"),
		packageCount: integer("package_count").notNull().default(0),
		authorCount: integer("author_count").notNull().default(0),
		successCount: integer("success_count").notNull().default(0),
		failureCount: integer("failure_count").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		processedAt: timestamp("processed_at", { withTimezone: true }),
	},
	(table) => ({
		projectIdx: index("idx_oss_dist_project").on(table.ossProjectId),
		statusIdx: index("idx_oss_dist_status").on(table.status),
		periodIdx: index("idx_oss_dist_period").on(table.periodStart),
	}),
);

export const ossPayments = pgTable(
	"oss_payments",
	{
		paymentId: uuid("payment_id").defaultRandom().primaryKey(),
		distributionId: uuid("distribution_id")
			.notNull()
			.references(() => ossDistributions.distributionId, { onDelete: "cascade" }),
		authorId: uuid("author_id")
			.notNull()
			.references(() => ossAuthors.authorId, { onDelete: "cascade" }),
		packageId: uuid("package_id")
			.notNull()
			.references(() => ossPackages.packageId, { onDelete: "cascade" }),
		amount: numeric("amount", { precision: 12, scale: 4 }).notNull(),
		paymentType: paymentTypeEnum("payment_type").notNull(),
		transactionId: text("transaction_id"),
		walletTransactionId: uuid("wallet_transaction_id").references(
			() => walletTransactions.transactionId,
			{ onDelete: "set null" },
		),
		status: text("status").notNull().default("pending"),
		errorMessage: text("error_message"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		processedAt: timestamp("processed_at", { withTimezone: true }),
	},
	(table) => ({
		distributionIdx: index("idx_oss_payments_dist").on(table.distributionId),
		authorIdx: index("idx_oss_payments_author").on(table.authorId),
		statusIdx: index("idx_oss_payments_status").on(table.status),
	}),
);

// ============================================================================
// Relations
// ============================================================================

export const ossAuthorsRelations = relations(ossAuthors, ({ many }) => ({
	paymentAddresses: many(ossPaymentAddresses),
	packageAuthors: many(ossPackageAuthors),
	payments: many(ossPayments),
}));

export const ossPaymentAddressesRelations = relations(ossPaymentAddresses, ({ one }) => ({
	author: one(ossAuthors, {
		fields: [ossPaymentAddresses.authorId],
		references: [ossAuthors.authorId],
	}),
}));

export const ossPackagesRelations = relations(ossPackages, ({ many }) => ({
	packageAuthors: many(ossPackageAuthors),
	projectDependencies: many(ossProjectDependencies),
	usageAttributions: many(ossUsageAttributions),
	payments: many(ossPayments),
}));

export const ossPackageAuthorsRelations = relations(ossPackageAuthors, ({ one }) => ({
	package: one(ossPackages, {
		fields: [ossPackageAuthors.packageId],
		references: [ossPackages.packageId],
	}),
	author: one(ossAuthors, {
		fields: [ossPackageAuthors.authorId],
		references: [ossAuthors.authorId],
	}),
}));

export const ossProjectsRelations = relations(ossProjects, ({ one, many }) => ({
	organization: one(organization, {
		fields: [ossProjects.organizationId],
		references: [organization.id],
	}),
	dependencies: many(ossProjectDependencies),
	usageAttributions: many(ossUsageAttributions),
	distributions: many(ossDistributions),
}));

export const ossProjectDependenciesRelations = relations(ossProjectDependencies, ({ one }) => ({
	project: one(ossProjects, {
		fields: [ossProjectDependencies.ossProjectId],
		references: [ossProjects.ossProjectId],
	}),
	package: one(ossPackages, {
		fields: [ossProjectDependencies.packageId],
		references: [ossPackages.packageId],
	}),
}));

export const ossUsageAttributionsRelations = relations(ossUsageAttributions, ({ one }) => ({
	project: one(ossProjects, {
		fields: [ossUsageAttributions.ossProjectId],
		references: [ossProjects.ossProjectId],
	}),
	package: one(ossPackages, {
		fields: [ossUsageAttributions.packageId],
		references: [ossPackages.packageId],
	}),
}));

export const ossDistributionsRelations = relations(ossDistributions, ({ one, many }) => ({
	project: one(ossProjects, {
		fields: [ossDistributions.ossProjectId],
		references: [ossProjects.ossProjectId],
	}),
	payments: many(ossPayments),
}));

export const ossPaymentsRelations = relations(ossPayments, ({ one }) => ({
	distribution: one(ossDistributions, {
		fields: [ossPayments.distributionId],
		references: [ossDistributions.distributionId],
	}),
	author: one(ossAuthors, {
		fields: [ossPayments.authorId],
		references: [ossAuthors.authorId],
	}),
	package: one(ossPackages, {
		fields: [ossPayments.packageId],
		references: [ossPackages.packageId],
	}),
	walletTransaction: one(walletTransactions, {
		fields: [ossPayments.walletTransactionId],
		references: [walletTransactions.transactionId],
	}),
}));

// ============================================================================
// Zod Validation Schemas
// ============================================================================

export const apiRegisterOssProject = z.object({
	name: z.string().min(1).max(255),
	repositoryUrl: z.string().url().optional(),
	monthlyBudget: z.number().min(0).optional(),
	autoDistribute: z.boolean().optional(),
});

export const apiRegisterOssPackage = z.object({
	name: z.string().min(1).max(255),
	ecosystem: z.enum(["npm", "cargo", "pypi", "go"]),
	repositoryUrl: z.string().url().optional(),
	license: z.string().optional(),
	authors: z
		.array(
			z.object({
				name: z.string().min(1),
				email: z.string().email().optional(),
				githubUsername: z.string().optional(),
				sharePercentage: z.number().min(0).max(1),
				role: z.enum(["primary", "maintainer", "contributor"]),
			}),
		)
		.optional(),
});

export const apiClaimAuthorPackages = z.object({
	githubCode: z.string().min(1),
	paymentAddresses: z
		.array(
			z.object({
				type: z.enum([
					"github_sponsors",
					"open_collective",
					"ethereum",
					"bitcoin",
					"lux",
					"stripe",
				]),
				address: z.string().min(1),
			}),
		)
		.optional(),
});

export const apiScanDependencies = z.object({
	ossProjectId: z.string().uuid(),
	manifests: z.object({
		packageJson: z.string().optional(),
		packageLock: z.string().optional(),
		cargoToml: z.string().optional(),
		cargoLock: z.string().optional(),
		requirementsTxt: z.string().optional(),
		pyprojectToml: z.string().optional(),
		goMod: z.string().optional(),
	}),
});

export const apiCalculateDistribution = z.object({
	ossProjectId: z.string().uuid(),
	totalAmount: z.number().min(0),
	periodStart: z.string().datetime(),
	periodEnd: z.string().datetime(),
	dryRun: z.boolean().default(false),
});

export const apiGetProjectAttribution = z.object({
	ossProjectId: z.string().uuid(),
});

export const apiGetAuthorPayments = z.object({
	authorId: z.string().uuid(),
	limit: z.number().min(1).max(100).default(50),
	offset: z.number().min(0).default(0),
});

// ============================================================================
// Type Exports
// ============================================================================

export type OssAuthor = typeof ossAuthors.$inferSelect;
export type OssPaymentAddress = typeof ossPaymentAddresses.$inferSelect;
export type OssPackage = typeof ossPackages.$inferSelect;
export type OssPackageAuthor = typeof ossPackageAuthors.$inferSelect;
export type OssProject = typeof ossProjects.$inferSelect;
export type OssProjectDependency = typeof ossProjectDependencies.$inferSelect;
export type OssUsageAttribution = typeof ossUsageAttributions.$inferSelect;
export type OssDistribution = typeof ossDistributions.$inferSelect;
export type OssPayment = typeof ossPayments.$inferSelect;
