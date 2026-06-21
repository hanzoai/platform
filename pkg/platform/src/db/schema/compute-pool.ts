/**
 * Compute Pool Schema
 *
 * Compute pools represent collections of compute resources provided by operators
 * on the Hanzo Network. They abstract physical infrastructure into logical pools
 * that can be rented by consumers.
 *
 * Architecture:
 * - Provider (organization) -> manages multiple ComputePools
 * - ComputePool -> contains multiple ComputeNodes
 * - ComputePool -> has multiple ComputeOffers (pricing tiers)
 * - Consumer -> rents via ComputeOffer -> creates ComputeLease
 */

import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";
import { user } from "./user";

// ============================================================================
// Enums
// ============================================================================

// ============================================================================
// Compute Pool
// ============================================================================

export const computePool = sqliteTable(
	"compute_pool",
	{
		poolId: text("pool_id")

			.primaryKey()
			.$defaultFn(() => nanoid()),

		// Ownership
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		ownerId: text("owner_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),

		// Identity
		name: text("name").notNull(),
		slug: text("slug").notNull(),
		description: text("description"),

		// Network identity
		networkAddress: text("network_address"), // On-chain address for this pool
		peerId: text("peer_id"), // libp2p peer ID for discovery

		// Status
		status: text("status", {
			enum: ["pending", "active", "maintenance", "suspended", "decommissioned"],
		})
			.notNull()
			.default("pending"),

		// Geographic distribution
		regions: text("regions", { mode: "json" })
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'`),
		primaryRegion: text("primary_region"),

		// Aggregate capacity (computed from nodes)
		totalCpuCores: integer("total_cpu_cores").notNull().default(0),
		totalMemoryMb: integer("total_memory_mb").notNull().default(0),
		totalStorageGb: integer("total_storage_gb").notNull().default(0),
		totalGpuCount: integer("total_gpu_count").notNull().default(0),

		// Available capacity (not leased)
		availableCpuCores: integer("available_cpu_cores").notNull().default(0),
		availableMemoryMb: integer("available_memory_mb").notNull().default(0),
		availableStorageGb: integer("available_storage_gb").notNull().default(0),
		availableGpuCount: integer("available_gpu_count").notNull().default(0),

		// Node counts
		totalNodes: integer("total_nodes").notNull().default(0),
		activeNodes: integer("active_nodes").notNull().default(0),

		// Configuration
		config: text("config", { mode: "json" })
			.$type<{
				// Network settings
				allowedNetworks?: string[];
				firewallRules?: Array<{
					protocol: "tcp" | "udp";
					portRange: string;
					cidr: string;
					action: "allow" | "deny";
				}>;
				// Resource limits
				maxLeaseDurationHours?: number;
				maxConcurrentLeases?: number;
				// Features
				features?: string[];
				// Supported workload types
				workloadTypes?: Array<"container" | "vm" | "bare-metal" | "serverless">;
			}>()
			.default({}),

		// Compliance and certifications
		certifications: text("certifications", { mode: "json" })
			.$type<string[]>()
			.default(sql`'[]'`), // SOC2, HIPAA, etc.

		// Metadata
		metadata: text("metadata", { mode: "json" }).$type<
			Record<string, unknown>
		>(),

		// Timestamps
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		lastHealthCheck: integer("last_health_check", { mode: "timestamp_ms" }),
	},
	(table) => ({
		orgIdIdx: index("idx_compute_pool_org").on(table.organizationId),
		statusIdx: index("idx_compute_pool_status").on(table.status),
		regionIdx: index("idx_compute_pool_region").on(table.primaryRegion),
		slugIdx: index("idx_compute_pool_slug").on(table.slug),
		networkAddressIdx: index("idx_compute_pool_network").on(
			table.networkAddress,
		),
	}),
);

// ============================================================================
// Compute Node
// ============================================================================

export const computeNode = sqliteTable(
	"compute_node",
	{
		nodeId: text("node_id")
			.primaryKey()
			.$defaultFn(() => nanoid()),

		// Pool association
		poolId: text("pool_id")
			.notNull()
			.references(() => computePool.poolId, { onDelete: "cascade" }),

		// Identity
		name: text("name").notNull(),
		hostname: text("hostname"),

		// Network identity
		networkAddress: text("network_address"), // On-chain identity
		peerId: text("peer_id"), // libp2p peer ID
		ipAddress: text("ip_address"),
		port: integer("port").default(4500),

		// Type and status
		nodeType: text("node_type", {
			enum: ["validator", "worker", "storage", "gpu", "inference"],
		})
			.notNull()
			.default("worker"),
		status: text("status", {
			enum: ["online", "offline", "syncing", "draining", "maintenance"],
		})
			.notNull()
			.default("offline"),

		// Location
		region: text("region").notNull(),
		datacenter: text("datacenter"),
		availabilityZone: text("availability_zone"),

		// Resources - CPU
		cpuCores: integer("cpu_cores").notNull(),
		cpuModel: text("cpu_model"),
		cpuArchitecture: text("cpu_architecture").default("x86_64"), // x86_64, arm64
		cpuFrequencyMhz: integer("cpu_frequency_mhz"),

		// Resources - Memory
		memoryMb: integer("memory_mb").notNull(),
		memoryType: text("memory_type"), // DDR4, DDR5, HBM

		// Resources - Storage
		storageGb: integer("storage_gb").notNull(),
		storageType: text("storage_type"), // nvme, ssd, hdd
		storageIops: integer("storage_iops"),

		// Resources - GPU
		gpuCount: integer("gpu_count").default(0),
		gpuVendor: text("gpu_vendor", {
			enum: ["nvidia", "amd", "intel", "apple"],
		}),
		gpuModel: text("gpu_model"),
		gpuMemoryMb: integer("gpu_memory_mb"),
		gpuComputeCapability: text("gpu_compute_capability"), // CUDA compute capability

		// Resources - Network
		networkBandwidthMbps: integer("network_bandwidth_mbps").default(1000),

		// Utilization (updated periodically)
		cpuUtilizationPercent: text("cpu_utilization_percent").default("0"),
		memoryUtilizationPercent: text("memory_utilization_percent").default("0"),
		storageUtilizationPercent: text("storage_utilization_percent").default("0"),
		gpuUtilizationPercent: text("gpu_utilization_percent").default("0"),

		// Health metrics
		uptimeSeconds: integer("uptime_seconds").default(0),
		lastHeartbeat: integer("last_heartbeat", { mode: "timestamp_ms" }),
		healthScore: text("health_score").default("100"), // 0-100

		// Software
		osVersion: text("os_version"),
		runtimeVersion: text("runtime_version"), // Container runtime version
		agentVersion: text("agent_version"), // Hanzo agent version

		// Configuration
		labels: text("labels", { mode: "json" })
			.$type<Record<string, string>>()
			.default({}),
		taints: text("taints", { mode: "json" })
			.$type<
				Array<{
					key: string;
					value: string;
					effect: "NoSchedule" | "PreferNoSchedule" | "NoExecute";
				}>
			>()
			.default([]),

		// Timestamps
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		registeredAt: integer("registered_at", { mode: "timestamp_ms" }),
	},
	(table) => ({
		poolIdIdx: index("idx_compute_node_pool").on(table.poolId),
		statusIdx: index("idx_compute_node_status").on(table.status),
		typeIdx: index("idx_compute_node_type").on(table.nodeType),
		regionIdx: index("idx_compute_node_region").on(table.region),
		networkAddressIdx: index("idx_compute_node_network").on(
			table.networkAddress,
		),
		heartbeatIdx: index("idx_compute_node_heartbeat").on(table.lastHeartbeat),
	}),
);

// ============================================================================
// Relations
// ============================================================================

export const computePoolRelations = relations(computePool, ({ one, many }) => ({
	organization: one(organization, {
		fields: [computePool.organizationId],
		references: [organization.id],
	}),
	owner: one(user, {
		fields: [computePool.ownerId],
		references: [user.id],
	}),
	nodes: many(computeNode),
}));

export const computeNodeRelations = relations(computeNode, ({ one }) => ({
	pool: one(computePool, {
		fields: [computeNode.poolId],
		references: [computePool.poolId],
	}),
}));

// ============================================================================
// Zod Schemas for API Validation
// ============================================================================

const createPoolSchema = createInsertSchema(computePool, {
	name: z.string().min(1).max(100),
	slug: z
		.string()
		.min(1)
		.max(100)
		.regex(/^[a-z0-9-]+$/),
	description: z.string().max(1000).optional(),
	regions: z.array(z.string()).optional(),
	primaryRegion: z.string().optional(),
});

export const apiCreateComputePool = createPoolSchema
	.pick({
		name: true,
		slug: true,
		description: true,
		regions: true,
		primaryRegion: true,
	})
	.required({ name: true, slug: true });

export const apiUpdateComputePool = createPoolSchema
	.pick({
		name: true,
		description: true,
		status: true,
		regions: true,
		primaryRegion: true,
		config: true,
	})
	.partial()
	.extend({
		poolId: z.string().min(1),
	});

const createNodeSchema = createInsertSchema(computeNode, {
	name: z.string().min(1).max(100),
	hostname: z.string().optional(),
	ipAddress: z.string().optional(),
	port: z.number().int().min(1).max(65535).optional(),
	region: z.string().min(1),
	cpuCores: z.number().int().min(1),
	memoryMb: z.number().int().min(512),
	storageGb: z.number().int().min(10),
	gpuCount: z.number().int().min(0).optional(),
});

export const apiRegisterComputeNode = createNodeSchema
	.pick({
		poolId: true,
		name: true,
		hostname: true,
		ipAddress: true,
		port: true,
		nodeType: true,
		region: true,
		datacenter: true,
		availabilityZone: true,
		cpuCores: true,
		cpuModel: true,
		cpuArchitecture: true,
		cpuFrequencyMhz: true,
		memoryMb: true,
		memoryType: true,
		storageGb: true,
		storageType: true,
		storageIops: true,
		gpuCount: true,
		gpuVendor: true,
		gpuModel: true,
		gpuMemoryMb: true,
		gpuComputeCapability: true,
		networkBandwidthMbps: true,
		osVersion: true,
		runtimeVersion: true,
		agentVersion: true,
		labels: true,
		taints: true,
	})
	.required({
		poolId: true,
		name: true,
		region: true,
		cpuCores: true,
		memoryMb: true,
		storageGb: true,
	});

export const apiUpdateComputeNode = createNodeSchema
	.pick({
		name: true,
		status: true,
		labels: true,
		taints: true,
	})
	.partial()
	.extend({
		nodeId: z.string().min(1),
	});

export const apiNodeHeartbeat = z.object({
	nodeId: z.string().min(1),
	status: z.enum(["online", "offline", "syncing", "draining", "maintenance"]),
	cpuUtilizationPercent: z.number().min(0).max(100),
	memoryUtilizationPercent: z.number().min(0).max(100),
	storageUtilizationPercent: z.number().min(0).max(100),
	gpuUtilizationPercent: z.number().min(0).max(100).optional(),
	uptimeSeconds: z.number().int().min(0),
	healthScore: z.number().min(0).max(100),
});

// ============================================================================
// Types
// ============================================================================

export type ComputePool = typeof computePool.$inferSelect;
export type NewComputePool = typeof computePool.$inferInsert;
export type ComputeNode = typeof computeNode.$inferSelect;
export type NewComputeNode = typeof computeNode.$inferInsert;
