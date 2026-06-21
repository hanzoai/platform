/**
 * OSS Author Payment Tracking Schema
 *
 * Tracks open-source dependencies, attributes contributions to authors,
 * and manages payment distribution from compute revenue.
 */

import { relations } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { organization } from "./account";
import { walletTransactions } from "./wallet";

// Enums

// ============================================================================
// OSS Authors
// ============================================================================

export const ossAuthors = sqliteTable(
	"oss_authors",
	{
		authorId: text("author_id")
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		name: text("name").notNull(),
		email: text("email"),
		githubUsername: text("github_username").unique(),
		verified: integer("verified", { mode: "boolean" }).notNull().default(false),
		verificationDate: integer("verification_date", { mode: "timestamp_ms" }),
		lastActive: integer("last_active", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => ({
		githubIdx: index("idx_oss_authors_github").on(table.githubUsername),
		emailIdx: index("idx_oss_authors_email").on(table.email),
	}),
);

export const ossPaymentAddresses = sqliteTable(
	"oss_payment_addresses",
	{
		addressId: text("address_id")
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		authorId: text("author_id")
			.notNull()
			.references(() => ossAuthors.authorId, { onDelete: "cascade" }),
		addressType: text("address_type", {
			enum: [
				"github_sponsors",
				"open_collective",
				"ethereum",
				"bitcoin",
				"lux",
				"stripe",
			],
		}).notNull(),
		address: text("address").notNull(),
		verified: integer("verified", { mode: "boolean" }).notNull().default(false),
		preferred: integer("preferred", { mode: "boolean" })
			.notNull()
			.default(false),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
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

export const ossPackages = sqliteTable(
	"oss_packages",
	{
		packageId: text("package_id")
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		name: text("name").notNull(),
		ecosystem: text("ecosystem", {
			enum: ["npm", "cargo", "pypi", "go"],
		}).notNull(),
		version: text("version"),
		repositoryUrl: text("repository_url"),
		homepageUrl: text("homepage_url"),
		license: text("license"),
		description: text("description"),
		lastFetched: integer("last_fetched", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => ({
		ecosystemIdx: index("idx_oss_packages_ecosystem").on(table.ecosystem),
		nameEcosystemIdx: uniqueIndex("idx_oss_packages_name_ecosystem").on(
			table.name,
			table.ecosystem,
		),
	}),
);

export const ossPackageAuthors = sqliteTable(
	"oss_package_authors",
	{
		packageId: text("package_id")
			.notNull()
			.references(() => ossPackages.packageId, { onDelete: "cascade" }),
		authorId: text("author_id")
			.notNull()
			.references(() => ossAuthors.authorId, { onDelete: "cascade" }),
		sharePercentage: text("share_percentage").notNull(),
		role: text("role", {
			enum: ["primary", "maintainer", "contributor"],
		}).notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => ({
		pk: uniqueIndex("idx_oss_pkg_authors_pk").on(
			table.packageId,
			table.authorId,
		),
		packageIdx: index("idx_oss_pkg_authors_package").on(table.packageId),
		authorIdx: index("idx_oss_pkg_authors_author").on(table.authorId),
	}),
);

// ============================================================================
// OSS Projects (tracked projects using OSS)
// ============================================================================

export const ossProjects = sqliteTable(
	"oss_projects",
	{
		ossProjectId: text("oss_project_id")
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		repositoryUrl: text("repository_url"),
		lastScan: integer("last_scan", { mode: "timestamp_ms" }),
		monthlyBudget: text("monthly_budget"),
		autoDistribute: integer("auto_distribute", { mode: "boolean" })
			.notNull()
			.default(false),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => ({
		orgIdx: index("idx_oss_projects_org").on(table.organizationId),
	}),
);

export const ossProjectDependencies = sqliteTable(
	"oss_project_dependencies",
	{
		ossProjectId: text("oss_project_id")
			.notNull()
			.references(() => ossProjects.ossProjectId, { onDelete: "cascade" }),
		packageId: text("package_id")
			.notNull()
			.references(() => ossPackages.packageId, { onDelete: "cascade" }),
		version: text("version"),
		isDirect: integer("is_direct", { mode: "boolean" }).notNull(),
		depth: integer("depth").notNull().default(0),
		usageCount: integer("usage_count").notNull().default(0),
		firstAdded: integer("first_added", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		lastSeen: integer("last_seen", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => ({
		pk: uniqueIndex("idx_oss_proj_deps_pk").on(
			table.ossProjectId,
			table.packageId,
		),
		projectIdx: index("idx_oss_proj_deps_project").on(table.ossProjectId),
		packageIdx: index("idx_oss_proj_deps_package").on(table.packageId),
	}),
);

// ============================================================================
// Usage Attribution (compute job -> OSS packages used)
// ============================================================================

export const ossUsageAttributions = sqliteTable(
	"oss_usage_attributions",
	{
		attributionId: text("attribution_id")
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		ossProjectId: text("oss_project_id")
			.notNull()
			.references(() => ossProjects.ossProjectId, { onDelete: "cascade" }),
		packageId: text("package_id")
			.notNull()
			.references(() => ossPackages.packageId, { onDelete: "cascade" }),
		computeJobId: text("compute_job_id"),
		computeCost: text("compute_cost").notNull(),
		attributedShare: text("attributed_share").notNull(),
		attributedAmount: text("attributed_amount").notNull(),
		periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
		periodEnd: integer("period_end", { mode: "timestamp_ms" }).notNull(),
		processed: integer("processed", { mode: "boolean" })
			.notNull()
			.default(false),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => ({
		projectIdx: index("idx_oss_usage_attr_project").on(table.ossProjectId),
		packageIdx: index("idx_oss_usage_attr_package").on(table.packageId),
		periodIdx: index("idx_oss_usage_attr_period").on(
			table.periodStart,
			table.periodEnd,
		),
		unprocessedIdx: index("idx_oss_usage_attr_unprocessed").on(table.processed),
	}),
);

// ============================================================================
// Distributions and Payments
// ============================================================================

export const ossDistributions = sqliteTable(
	"oss_distributions",
	{
		distributionId: text("distribution_id")
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		ossProjectId: text("oss_project_id")
			.notNull()
			.references(() => ossProjects.ossProjectId, { onDelete: "cascade" }),
		totalAmount: text("total_amount").notNull(),
		currency: text("currency").notNull().default("USD"),
		periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
		periodEnd: integer("period_end", { mode: "timestamp_ms" }).notNull(),
		status: text("status", {
			enum: ["pending", "processing", "completed", "failed"],
		})
			.notNull()
			.default("pending"),
		packageCount: integer("package_count").notNull().default(0),
		authorCount: integer("author_count").notNull().default(0),
		successCount: integer("success_count").notNull().default(0),
		failureCount: integer("failure_count").notNull().default(0),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		processedAt: integer("processed_at", { mode: "timestamp_ms" }),
	},
	(table) => ({
		projectIdx: index("idx_oss_dist_project").on(table.ossProjectId),
		statusIdx: index("idx_oss_dist_status").on(table.status),
		periodIdx: index("idx_oss_dist_period").on(table.periodStart),
	}),
);

export const ossPayments = sqliteTable(
	"oss_payments",
	{
		paymentId: text("payment_id")
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		distributionId: text("distribution_id")
			.notNull()
			.references(() => ossDistributions.distributionId, {
				onDelete: "cascade",
			}),
		authorId: text("author_id")
			.notNull()
			.references(() => ossAuthors.authorId, { onDelete: "cascade" }),
		packageId: text("package_id")
			.notNull()
			.references(() => ossPackages.packageId, { onDelete: "cascade" }),
		amount: text("amount").notNull(),
		paymentType: text("payment_type", {
			enum: [
				"github_sponsors",
				"open_collective",
				"ethereum",
				"bitcoin",
				"lux",
				"stripe",
			],
		}).notNull(),
		transactionId: text("transaction_id"),
		walletTransactionId: text("wallet_transaction_id").references(
			() => walletTransactions.transactionId,
			{ onDelete: "set null" },
		),
		status: text("status").notNull().default("pending"),
		errorMessage: text("error_message"),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		processedAt: integer("processed_at", { mode: "timestamp_ms" }),
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

export const ossPaymentAddressesRelations = relations(
	ossPaymentAddresses,
	({ one }) => ({
		author: one(ossAuthors, {
			fields: [ossPaymentAddresses.authorId],
			references: [ossAuthors.authorId],
		}),
	}),
);

export const ossPackagesRelations = relations(ossPackages, ({ many }) => ({
	packageAuthors: many(ossPackageAuthors),
	projectDependencies: many(ossProjectDependencies),
	usageAttributions: many(ossUsageAttributions),
	payments: many(ossPayments),
}));

export const ossPackageAuthorsRelations = relations(
	ossPackageAuthors,
	({ one }) => ({
		package: one(ossPackages, {
			fields: [ossPackageAuthors.packageId],
			references: [ossPackages.packageId],
		}),
		author: one(ossAuthors, {
			fields: [ossPackageAuthors.authorId],
			references: [ossAuthors.authorId],
		}),
	}),
);

export const ossProjectsRelations = relations(ossProjects, ({ one, many }) => ({
	organization: one(organization, {
		fields: [ossProjects.organizationId],
		references: [organization.id],
	}),
	dependencies: many(ossProjectDependencies),
	usageAttributions: many(ossUsageAttributions),
	distributions: many(ossDistributions),
}));

export const ossProjectDependenciesRelations = relations(
	ossProjectDependencies,
	({ one }) => ({
		project: one(ossProjects, {
			fields: [ossProjectDependencies.ossProjectId],
			references: [ossProjects.ossProjectId],
		}),
		package: one(ossPackages, {
			fields: [ossProjectDependencies.packageId],
			references: [ossPackages.packageId],
		}),
	}),
);

export const ossUsageAttributionsRelations = relations(
	ossUsageAttributions,
	({ one }) => ({
		project: one(ossProjects, {
			fields: [ossUsageAttributions.ossProjectId],
			references: [ossProjects.ossProjectId],
		}),
		package: one(ossPackages, {
			fields: [ossUsageAttributions.packageId],
			references: [ossPackages.packageId],
		}),
	}),
);

export const ossDistributionsRelations = relations(
	ossDistributions,
	({ one, many }) => ({
		project: one(ossProjects, {
			fields: [ossDistributions.ossProjectId],
			references: [ossProjects.ossProjectId],
		}),
		payments: many(ossPayments),
	}),
);

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
