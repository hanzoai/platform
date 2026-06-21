/**
 * Compute Offer Schema
 *
 * Offers define pricing and terms for compute resources from pools.
 * They enable a marketplace where providers list resources at various
 * price points and configurations.
 *
 * Architecture:
 * - ComputePool -> has multiple ComputeOffers
 * - ComputeOffer -> defines pricing (per-hour, per-resource)
 * - Consumer accepts offer -> creates ComputeLease
 * - ComputeLease -> tracks actual resource consumption
 */

import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";
import { computeNode, computePool } from "./compute-pool";
import { user } from "./user";
import { organizationWallet, walletTransactions } from "./wallet";

// ============================================================================
// Enums
// ============================================================================

// ============================================================================
// Compute Offer
// ============================================================================

export const computeOffer = sqliteTable(
	"compute_offer",
	{
		offerId: text("offer_id")

			.primaryKey()
			.$defaultFn(() => nanoid()),

		// Pool association
		poolId: text("pool_id")
			.notNull()
			.references(() => computePool.poolId, { onDelete: "cascade" }),

		// Identity
		name: text("name").notNull(),
		description: text("description"),
		slug: text("slug").notNull(),

		// Status
		status: text("status", {
			enum: ["draft", "active", "paused", "expired", "depleted", "retired"],
		})
			.notNull()
			.default("draft"),

		// Resource specification (what you get)
		resourceSpec: text("resource_spec", { mode: "json" }).notNull().$type<{
			// CPU
			cpuCores: number;
			cpuArchitecture?: "x86_64" | "arm64";
			cpuMinFrequencyMhz?: number;

			// Memory
			memoryMb: number;

			// Storage
			storageGb: number;
			storageType?: "nvme" | "ssd" | "hdd";

			// GPU (optional)
			gpuCount?: number;
			gpuModel?: string;
			gpuMemoryMb?: number;

			// Network
			networkBandwidthMbps?: number;
			publicIpv4?: boolean;
			publicIpv6?: boolean;

			// Node requirements
			nodeType?: "validator" | "worker" | "storage" | "gpu" | "inference";
			regions?: string[];

			// Labels/selectors for node matching
			nodeSelector?: Record<string, string>;
		}>(),

		// Pricing
		pricingModel: text("pricing_model", {
			enum: ["per_hour", "per_resource_hour", "spot", "reserved", "auction"],
		})
			.notNull()
			.default("per_hour"),
		currency: text("currency").notNull().default("USD"),

		// Base prices (in smallest currency unit, e.g., cents)
		basePrice: text("base_price").notNull(), // Per billing cycle

		// Resource-based pricing (for per_resource_hour model)
		pricePerCpuHour: text("price_per_cpu_hour"),
		pricePerGbMemoryHour: text("price_per_gb_memory_hour"),
		pricePerGbStorageHour: text("price_per_gb_storage_hour"),
		pricePerGpuHour: text("price_per_gpu_hour"),
		pricePerGbEgress: text("price_per_gb_egress"),

		// Billing
		billingCycle: text("billing_cycle", {
			enum: ["hourly", "daily", "weekly", "monthly"],
		})
			.notNull()
			.default("hourly"),
		minimumBillingMinutes: integer("minimum_billing_minutes").default(60),

		// Discounts
		spotDiscount: text("spot_discount"), // Percentage discount for spot
		reservedDiscount: text("reserved_discount"), // For 1-month commitment
		annualDiscount: text("annual_discount"), // For 1-year commitment

		// Capacity
		totalCapacity: integer("total_capacity").notNull().default(1), // Max concurrent leases
		usedCapacity: integer("used_capacity").notNull().default(0),
		availableCapacity: integer("available_capacity").notNull().default(1),

		// Limits
		minLeaseDurationMinutes: integer("min_lease_duration_minutes").default(60),
		maxLeaseDurationDays: integer("max_lease_duration_days").default(365),
		maxConcurrentLeasesPerOrg: integer("max_concurrent_leases_per_org").default(
			10,
		),

		// Validity
		validFrom: integer("valid_from", { mode: "timestamp_ms" }).$defaultFn(
			() => new Date(),
		),
		validUntil: integer("valid_until", { mode: "timestamp_ms" }),

		// SLA and guarantees
		sla: text("sla", { mode: "json" })
			.$type<{
				uptimeGuarantee?: number; // Percentage, e.g., 99.9
				supportResponseHours?: number;
				refundPolicy?: string;
				provisioningTimeMinutes?: number;
			}>()
			.default({}),

		// Features and restrictions
		features: text("features", { mode: "json" })
			.$type<string[]>()
			.default(sql`'[]'`), // e.g., ["ssh-access", "root-access", "custom-image"]

		restrictions: text("restrictions", { mode: "json" })
			.$type<{
				allowedRegions?: string[];
				blockedRegions?: string[];
				allowedWorkloadTypes?: string[];
				requireVerifiedOrg?: boolean;
				minimumOrgAge?: number; // Days
			}>()
			.default({}),

		// Metadata
		metadata: text("metadata", { mode: "json" }).$type<
			Record<string, unknown>
		>(),
		tags: text("tags", { mode: "json" }).$type<string[]>().default(sql`'[]'`),

		// Timestamps
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => ({
		poolIdIdx: index("idx_compute_offer_pool").on(table.poolId),
		statusIdx: index("idx_compute_offer_status").on(table.status),
		pricingIdx: index("idx_compute_offer_pricing").on(table.pricingModel),
		slugIdx: index("idx_compute_offer_slug").on(table.slug),
		priceIdx: index("idx_compute_offer_price").on(table.basePrice),
		capacityIdx: index("idx_compute_offer_capacity").on(
			table.availableCapacity,
		),
	}),
);

// ============================================================================
// Compute Lease
// ============================================================================

export const computeLease = sqliteTable(
	"compute_lease",
	{
		leaseId: text("lease_id")
			.primaryKey()
			.$defaultFn(() => nanoid()),

		// Offer and pool
		offerId: text("offer_id")
			.notNull()
			.references(() => computeOffer.offerId, { onDelete: "restrict" }),
		poolId: text("pool_id")
			.notNull()
			.references(() => computePool.poolId, { onDelete: "restrict" }),

		// Consumer
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),

		// Assigned node
		nodeId: text("node_id").references(() => computeNode.nodeId, {
			onDelete: "set null",
		}),

		// Identity
		name: text("name").notNull(),

		// Status
		status: text("status", {
			enum: [
				"pending",
				"provisioning",
				"active",
				"suspended",
				"terminating",
				"terminated",
				"failed",
			],
		})
			.notNull()
			.default("pending"),

		// On-chain reference
		networkTxHash: text("network_tx_hash"), // Transaction that created lease
		networkLeaseId: text("network_lease_id"), // On-chain lease identifier

		// Resource allocation (snapshot of what was leased)
		allocatedResources: text("allocated_resources", { mode: "json" })
			.notNull()
			.$type<{
				cpuCores: number;
				memoryMb: number;
				storageGb: number;
				gpuCount?: number;
				publicIpv4?: string;
				publicIpv6?: string;
				hostname?: string;
			}>(),

		// Pricing snapshot (locked at lease creation)
		pricingSnapshot: text("pricing_snapshot", { mode: "json" })
			.notNull()
			.$type<{
				pricingModel: string;
				basePrice: string;
				pricePerCpuHour?: string;
				pricePerGbMemoryHour?: string;
				pricePerGbStorageHour?: string;
				pricePerGpuHour?: string;
				pricePerGbEgress?: string;
				billingCycle: string;
				currency: string;
			}>(),

		// Timing
		requestedAt: integer("requested_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		provisionedAt: integer("provisioned_at", { mode: "timestamp_ms" }),
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		terminatedAt: integer("terminated_at", { mode: "timestamp_ms" }),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }),

		// Duration
		requestedDurationMinutes: integer("requested_duration_minutes"),
		actualDurationSeconds: integer("actual_duration_seconds").default(0),

		// Billing
		billedAmount: text("billed_amount").default("0"),
		lastBilledAt: integer("last_billed_at", { mode: "timestamp_ms" }),

		// Wallet link
		walletId: text("wallet_id").references(() => organizationWallet.walletId, {
			onDelete: "set null",
		}),

		// Access credentials (encrypted)
		accessCredentials: text("access_credentials", { mode: "json" }).$type<{
			sshPublicKey?: string;
			apiEndpoint?: string;
			apiToken?: string;
			kubeconfig?: string;
		}>(),

		// Connection info
		connectionInfo: text("connection_info", { mode: "json" }).$type<{
			ipAddress?: string;
			port?: number;
			sshPort?: number;
			webConsoleUrl?: string;
		}>(),

		// Usage tracking
		usageMetrics: text("usage_metrics", { mode: "json" })
			.$type<{
				cpuSecondsUsed?: number;
				memoryGbSecondsUsed?: number;
				storageGbSecondsUsed?: number;
				gpuSecondsUsed?: number;
				egressGb?: number;
			}>()
			.default({}),

		// Termination
		terminationReason: text("termination_reason"),
		terminatedBy: text("terminated_by"), // "user", "system", "provider", "expiry"

		// Metadata
		metadata: text("metadata", { mode: "json" }).$type<
			Record<string, unknown>
		>(),
		labels: text("labels", { mode: "json" })
			.$type<Record<string, string>>()
			.default({}),

		// Timestamps
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => ({
		offerIdIdx: index("idx_compute_lease_offer").on(table.offerId),
		poolIdIdx: index("idx_compute_lease_pool").on(table.poolId),
		orgIdIdx: index("idx_compute_lease_org").on(table.organizationId),
		userIdIdx: index("idx_compute_lease_user").on(table.userId),
		nodeIdIdx: index("idx_compute_lease_node").on(table.nodeId),
		statusIdx: index("idx_compute_lease_status").on(table.status),
		walletIdx: index("idx_compute_lease_wallet").on(table.walletId),
		expiresIdx: index("idx_compute_lease_expires").on(table.expiresAt),
		networkLeaseIdx: index("idx_compute_lease_network").on(
			table.networkLeaseId,
		),
	}),
);

// ============================================================================
// Compute Usage (granular billing records)
// ============================================================================

export const computeUsage = sqliteTable(
	"compute_usage",
	{
		usageId: text("usage_id")
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),

		// Associations
		leaseId: text("lease_id")
			.notNull()
			.references(() => computeLease.leaseId, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		offerId: text("offer_id")
			.notNull()
			.references(() => computeOffer.offerId, { onDelete: "cascade" }),

		// Time period
		periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
		periodEnd: integer("period_end", { mode: "timestamp_ms" }).notNull(),
		durationSeconds: integer("duration_seconds").notNull(),

		// Resource consumption
		cpuSeconds: text("cpu_seconds").notNull().default("0"),
		memoryGbSeconds: text("memory_gb_seconds").notNull().default("0"),
		storageGbSeconds: text("storage_gb_seconds").notNull().default("0"),
		gpuSeconds: text("gpu_seconds").notNull().default("0"),
		egressGb: text("egress_gb").notNull().default("0"),

		// Costs
		cpuCost: text("cpu_cost").notNull().default("0"),
		memoryCost: text("memory_cost").notNull().default("0"),
		storageCost: text("storage_cost").notNull().default("0"),
		gpuCost: text("gpu_cost").notNull().default("0"),
		egressCost: text("egress_cost").notNull().default("0"),
		baseCost: text("base_cost").notNull().default("0"),
		totalCost: text("total_cost").notNull().default("0"),

		// Billing
		charged: integer("charged", { mode: "boolean" }).notNull().default(false),
		chargedAt: integer("charged_at", { mode: "timestamp_ms" }),
		transactionId: text("transaction_id").references(
			() => walletTransactions.transactionId,
			{ onDelete: "set null" },
		),

		// Timestamps
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => ({
		leaseIdIdx: index("idx_compute_usage_lease").on(table.leaseId),
		orgIdIdx: index("idx_compute_usage_org").on(table.organizationId),
		periodIdx: index("idx_compute_usage_period").on(
			table.periodStart,
			table.periodEnd,
		),
		unchargedIdx: index("idx_compute_usage_uncharged").on(table.charged),
	}),
);

// ============================================================================
// Relations
// ============================================================================

export const computeOfferRelations = relations(
	computeOffer,
	({ one, many }) => ({
		pool: one(computePool, {
			fields: [computeOffer.poolId],
			references: [computePool.poolId],
		}),
		leases: many(computeLease),
	}),
);

export const computeLeaseRelations = relations(
	computeLease,
	({ one, many }) => ({
		offer: one(computeOffer, {
			fields: [computeLease.offerId],
			references: [computeOffer.offerId],
		}),
		pool: one(computePool, {
			fields: [computeLease.poolId],
			references: [computePool.poolId],
		}),
		node: one(computeNode, {
			fields: [computeLease.nodeId],
			references: [computeNode.nodeId],
		}),
		organization: one(organization, {
			fields: [computeLease.organizationId],
			references: [organization.id],
		}),
		user: one(user, {
			fields: [computeLease.userId],
			references: [user.id],
		}),
		wallet: one(organizationWallet, {
			fields: [computeLease.walletId],
			references: [organizationWallet.walletId],
		}),
		usage: many(computeUsage),
	}),
);

export const computeUsageRelations = relations(computeUsage, ({ one }) => ({
	lease: one(computeLease, {
		fields: [computeUsage.leaseId],
		references: [computeLease.leaseId],
	}),
	organization: one(organization, {
		fields: [computeUsage.organizationId],
		references: [organization.id],
	}),
	offer: one(computeOffer, {
		fields: [computeUsage.offerId],
		references: [computeOffer.offerId],
	}),
	transaction: one(walletTransactions, {
		fields: [computeUsage.transactionId],
		references: [walletTransactions.transactionId],
	}),
}));

// ============================================================================
// Zod Schemas for API Validation
// ============================================================================

const resourceSpecSchema = z.object({
	cpuCores: z.number().int().min(1),
	cpuArchitecture: z.enum(["x86_64", "arm64"]).optional(),
	cpuMinFrequencyMhz: z.number().int().positive().optional(),
	memoryMb: z.number().int().min(512),
	storageGb: z.number().int().min(1),
	storageType: z.enum(["nvme", "ssd", "hdd"]).optional(),
	gpuCount: z.number().int().min(0).optional(),
	gpuModel: z.string().optional(),
	gpuMemoryMb: z.number().int().positive().optional(),
	networkBandwidthMbps: z.number().int().positive().optional(),
	publicIpv4: z.boolean().optional(),
	publicIpv6: z.boolean().optional(),
	nodeType: z
		.enum(["validator", "worker", "storage", "gpu", "inference"])
		.optional(),
	regions: z.array(z.string()).optional(),
	nodeSelector: z.record(z.string(), z.string()).optional(),
});

const slaSchema = z.object({
	uptimeGuarantee: z.number().min(0).max(100).optional(),
	supportResponseHours: z.number().int().positive().optional(),
	refundPolicy: z.string().optional(),
	provisioningTimeMinutes: z.number().int().positive().optional(),
});

const createOfferSchema = createInsertSchema(computeOffer, {
	name: z.string().min(1).max(100),
	slug: z
		.string()
		.min(1)
		.max(100)
		.regex(/^[a-z0-9-]+$/),
	description: z.string().max(2000).optional(),
	basePrice: z.string().regex(/^\d+(\.\d{1,6})?$/),
});

export const apiCreateComputeOffer = createOfferSchema
	.pick({
		poolId: true,
		name: true,
		slug: true,
		description: true,
		pricingModel: true,
		currency: true,
		basePrice: true,
		pricePerCpuHour: true,
		pricePerGbMemoryHour: true,
		pricePerGbStorageHour: true,
		pricePerGpuHour: true,
		pricePerGbEgress: true,
		billingCycle: true,
		minimumBillingMinutes: true,
		spotDiscount: true,
		reservedDiscount: true,
		annualDiscount: true,
		totalCapacity: true,
		minLeaseDurationMinutes: true,
		maxLeaseDurationDays: true,
		maxConcurrentLeasesPerOrg: true,
		validFrom: true,
		validUntil: true,
		features: true,
		tags: true,
	})
	.extend({
		resourceSpec: resourceSpecSchema,
		sla: slaSchema.optional(),
		restrictions: z
			.object({
				allowedRegions: z.array(z.string()).optional(),
				blockedRegions: z.array(z.string()).optional(),
				allowedWorkloadTypes: z.array(z.string()).optional(),
				requireVerifiedOrg: z.boolean().optional(),
				minimumOrgAge: z.number().int().min(0).optional(),
			})
			.optional(),
	})
	.required({
		poolId: true,
		name: true,
		slug: true,
		resourceSpec: true,
		basePrice: true,
	});

export const apiUpdateComputeOffer = createOfferSchema
	.pick({
		name: true,
		description: true,
		status: true,
		basePrice: true,
		pricePerCpuHour: true,
		pricePerGbMemoryHour: true,
		pricePerGbStorageHour: true,
		pricePerGpuHour: true,
		pricePerGbEgress: true,
		totalCapacity: true,
		validUntil: true,
		features: true,
		tags: true,
	})
	.partial()
	.extend({
		offerId: z.string().min(1),
		sla: slaSchema.optional(),
		restrictions: z
			.object({
				allowedRegions: z.array(z.string()).optional(),
				blockedRegions: z.array(z.string()).optional(),
				allowedWorkloadTypes: z.array(z.string()).optional(),
				requireVerifiedOrg: z.boolean().optional(),
				minimumOrgAge: z.number().int().min(0).optional(),
			})
			.optional(),
	});

export const apiCreateComputeLease = z.object({
	offerId: z.string().min(1),
	name: z.string().min(1).max(100),
	durationMinutes: z.number().int().positive().optional(),
	accessCredentials: z
		.object({
			sshPublicKey: z.string().optional(),
		})
		.optional(),
	labels: z.record(z.string(), z.string()).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export const apiTerminateLease = z.object({
	leaseId: z.string().min(1),
	reason: z.string().optional(),
});

export const apiSearchOffers = z.object({
	// Resource requirements
	minCpuCores: z.number().int().min(1).optional(),
	minMemoryMb: z.number().int().min(512).optional(),
	minStorageGb: z.number().int().min(1).optional(),
	minGpuCount: z.number().int().min(0).optional(),
	gpuModel: z.string().optional(),

	// Location
	regions: z.array(z.string()).optional(),

	// Pricing
	maxPricePerHour: z.string().optional(),
	pricingModel: z
		.enum(["per_hour", "per_resource_hour", "spot", "reserved", "auction"])
		.optional(),

	// Features
	features: z.array(z.string()).optional(),

	// Pagination
	limit: z.number().int().min(1).max(100).default(20),
	offset: z.number().int().min(0).default(0),

	// Sorting
	sortBy: z.enum(["price", "capacity", "created_at"]).default("price"),
	sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

// ============================================================================
// Types
// ============================================================================

export type ComputeOffer = typeof computeOffer.$inferSelect;
export type NewComputeOffer = typeof computeOffer.$inferInsert;
export type ComputeLease = typeof computeLease.$inferSelect;
export type NewComputeLease = typeof computeLease.$inferInsert;
export type ComputeUsage = typeof computeUsage.$inferSelect;
export type NewComputeUsage = typeof computeUsage.$inferInsert;
