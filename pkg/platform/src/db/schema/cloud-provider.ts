/**
 * Cloud Provider Schema
 *
 * Enables Platform to provision and manage compute resources from cloud providers
 * like DigitalOcean, AWS, GCP, etc. This abstraction layer allows multi-cloud
 * deployments and automatic scaling of Platform clusters.
 *
 * Architecture:
 * - Organization -> has multiple CloudProviders (credentials)
 * - CloudProvider -> provisions ProvisionedInstances
 * - ProvisionedInstance -> links to ComputeNode (from compute-pool.ts)
 */

import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";
import { computeNode, computePool } from "./compute-pool";

// ============================================================================
// Enums
// ============================================================================

// ============================================================================
// Cloud Provider (Credentials & Config)
// ============================================================================

export const cloudProvider = sqliteTable(
	"cloud_provider",
	{
		providerId: text("provider_id")

			.primaryKey()
			.$defaultFn(() => nanoid()),

		// Ownership
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Provider identity
		providerType: text("provider_type", {
			enum: [
				"digitalocean",
				"aws",
				"gcp",
				"azure",
				"hetzner",
				"vultr",
				"linode",
			],
		}).notNull(),
		name: text("name").notNull(),
		slug: text("slug").notNull(),

		// Encrypted credentials (encrypted at application layer)
		credentials: text("credentials", { mode: "json" })
			.$type<{
				apiToken?: string; // DO API token (encrypted)
				accessKeyId?: string; // AWS access key
				secretAccessKey?: string; // AWS secret (encrypted)
				projectId?: string; // GCP project ID
				region?: string; // Default region
			}>()
			.notNull(),

		// Default configuration
		defaultRegion: text("default_region").notNull().default("nyc1"),
		defaultSize: text("default_size").notNull().default("s-2vcpu-4gb"),
		defaultImage: text("default_image").notNull().default("ubuntu-22-04-x64"),

		// VPC/Network configuration
		vpcConfig: text("vpc_config", { mode: "json" }).$type<{
			vpcId?: string;
			subnetId?: string;
			securityGroupId?: string;
		}>(),

		// SSH key management
		sshKeyIds: text("ssh_key_ids", { mode: "json" })
			.$type<string[]>()
			.default(sql`'[]'`),

		// Firewall configuration
		firewallId: text("firewall_id"),

		// Status
		isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
		lastValidated: integer("last_validated", { mode: "timestamp_ms" }),
		validationError: text("validation_error"),

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
	},
	(table) => ({
		orgIdIdx: index("idx_cloud_provider_org").on(table.organizationId),
		typeIdx: index("idx_cloud_provider_type").on(table.providerType),
		slugIdx: index("idx_cloud_provider_slug").on(
			table.organizationId,
			table.slug,
		),
	}),
);

// ============================================================================
// Provisioned Instance (Cloud Instance Tracking)
// ============================================================================

export const provisionedInstance = sqliteTable(
	"provisioned_instance",
	{
		instanceId: text("instance_id")
			.primaryKey()
			.$defaultFn(() => nanoid()),

		// Provider reference
		cloudProviderId: text("cloud_provider_id")
			.notNull()
			.references(() => cloudProvider.providerId, { onDelete: "cascade" }),

		// Pool reference (optional - some instances may be standalone)
		poolId: text("pool_id").references(() => computePool.poolId, {
			onDelete: "set null",
		}),

		// Compute node reference (created after registration)
		computeNodeId: text("compute_node_id").references(
			() => computeNode.nodeId,
			{ onDelete: "set null" },
		),

		// Provider-specific IDs
		externalId: text("external_id"), // DO droplet ID, AWS instance ID, etc.
		externalName: text("external_name").notNull(),

		// Configuration
		region: text("region").notNull(),
		size: text("size").notNull(),
		image: text("image").notNull(),
		vpcId: text("vpc_id"),

		// Status
		status: text("status", {
			enum: [
				"pending",
				"provisioning",
				"booting",
				"registering",
				"running",
				"draining",
				"stopping",
				"terminated",
				"failed",
			],
		})
			.notNull()
			.default("pending"),

		// Networking
		publicIp: text("public_ip"),
		privateIp: text("private_ip"),
		publicIpv6: text("public_ipv6"),

		// Bootstrap state
		registrationToken: text("registration_token"),
		registrationExpiry: integer("registration_expiry", {
			mode: "timestamp_ms",
		}),
		swarmJoinToken: text("swarm_join_token"),

		// Resource specifications
		cpuCores: integer("cpu_cores").notNull(),
		memoryMb: integer("memory_mb").notNull(),
		storageGb: integer("storage_gb").notNull(),
		gpuCount: integer("gpu_count").default(0),

		// Cost tracking
		hourlyPrice: text("hourly_price"), // Stored as string for precision
		monthlyPrice: text("monthly_price"),

		// Tags for organization
		tags: text("tags", { mode: "json" }).$type<string[]>().default(sql`'[]'`),

		// Error handling
		lastError: text("last_error"),
		errorCount: integer("error_count").notNull().default(0),

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
		provisionedAt: integer("provisioned_at", { mode: "timestamp_ms" }),
		registeredAt: integer("registered_at", { mode: "timestamp_ms" }),
		terminatedAt: integer("terminated_at", { mode: "timestamp_ms" }),
	},
	(table) => ({
		providerIdx: index("idx_provisioned_instance_provider").on(
			table.cloudProviderId,
		),
		poolIdx: index("idx_provisioned_instance_pool").on(table.poolId),
		nodeIdx: index("idx_provisioned_instance_node").on(table.computeNodeId),
		statusIdx: index("idx_provisioned_instance_status").on(table.status),
		externalIdx: index("idx_provisioned_instance_external").on(
			table.externalId,
		),
	}),
);

// ============================================================================
// Scaling Job (Track Async Operations)
// ============================================================================

export const scalingJob = sqliteTable(
	"scaling_job",
	{
		jobId: text("job_id")
			.primaryKey()
			.$defaultFn(() => nanoid()),

		// References
		poolId: text("pool_id")
			.notNull()
			.references(() => computePool.poolId, { onDelete: "cascade" }),
		cloudProviderId: text("cloud_provider_id")
			.notNull()
			.references(() => cloudProvider.providerId, { onDelete: "cascade" }),

		// Job type
		jobType: text("job_type").notNull(), // scale_up, scale_down, resize

		// Configuration
		config: text("config", { mode: "json" })
			.$type<{
				count?: number;
				size?: string;
				region?: string;
				nodeType?: string;
				strategy?: string;
				targetNodeIds?: string[];
			}>()
			.notNull(),

		// Status
		status: text("status").notNull().default("pending"), // pending, running, completed, failed
		progress: integer("progress").notNull().default(0), // 0-100

		// Results
		createdNodeIds: text("created_node_ids", { mode: "json" })
			.$type<string[]>()
			.default(sql`'[]'`),
		removedNodeIds: text("removed_node_ids", { mode: "json" })
			.$type<string[]>()
			.default(sql`'[]'`),

		// Error handling
		error: text("error"),
		errorDetails: text("error_details", { mode: "json" }),

		// Timestamps
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
	},
	(table) => ({
		poolIdx: index("idx_scaling_job_pool").on(table.poolId),
		statusIdx: index("idx_scaling_job_status").on(table.status),
	}),
);

// ============================================================================
// Relations
// ============================================================================

export const cloudProviderRelations = relations(
	cloudProvider,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [cloudProvider.organizationId],
			references: [organization.id],
		}),
		instances: many(provisionedInstance),
		scalingJobs: many(scalingJob),
	}),
);

export const provisionedInstanceRelations = relations(
	provisionedInstance,
	({ one }) => ({
		cloudProvider: one(cloudProvider, {
			fields: [provisionedInstance.cloudProviderId],
			references: [cloudProvider.providerId],
		}),
		pool: one(computePool, {
			fields: [provisionedInstance.poolId],
			references: [computePool.poolId],
		}),
		computeNode: one(computeNode, {
			fields: [provisionedInstance.computeNodeId],
			references: [computeNode.nodeId],
		}),
	}),
);

export const scalingJobRelations = relations(scalingJob, ({ one }) => ({
	pool: one(computePool, {
		fields: [scalingJob.poolId],
		references: [computePool.poolId],
	}),
	cloudProvider: one(cloudProvider, {
		fields: [scalingJob.cloudProviderId],
		references: [cloudProvider.providerId],
	}),
}));

// ============================================================================
// Zod Schemas for API Validation
// ============================================================================

const createProviderSchema = createInsertSchema(cloudProvider, {
	name: z.string().min(1).max(100),
	slug: z
		.string()
		.min(1)
		.max(100)
		.regex(/^[a-z0-9-]+$/),
});

export const apiConfigureCloudProvider = createProviderSchema
	.pick({
		name: true,
		slug: true,
		providerType: true,
		defaultRegion: true,
		defaultSize: true,
	})
	.extend({
		apiToken: z.string().min(1), // Will be encrypted before storage
		region: z.string().optional(),
		projectId: z.string().optional(),
	});

export const apiUpdateCloudProvider = createProviderSchema
	.pick({
		name: true,
		defaultRegion: true,
		defaultSize: true,
		defaultImage: true,
		isActive: true,
	})
	.partial()
	.extend({
		providerId: z.string().min(1),
		apiToken: z.string().optional(), // Only update if provided
	});

export const apiScaleUp = z.object({
	poolId: z.string().min(1),
	providerId: z.string().min(1),
	count: z.number().int().min(1).max(10),
	size: z.string().default("s-2vcpu-4gb"),
	region: z.string().default("nyc1"),
	nodeType: z.enum(["worker", "gpu", "storage", "inference"]).default("worker"),
	labels: z.record(z.string(), z.string()).optional(),
});

export const apiScaleDown = z.object({
	poolId: z.string().min(1),
	count: z.number().int().min(1),
	strategy: z.enum(["oldest", "newest", "least-utilized"]).default("oldest"),
	nodeIds: z.array(z.string()).optional(), // Specific nodes to remove
});

export const apiResizeInstance = z.object({
	instanceId: z.string().min(1),
	newSize: z.string().min(1),
	resizeDisk: z.boolean().default(false),
});

export const apiDrainNode = z.object({
	nodeId: z.string().min(1),
	force: z.boolean().default(false),
	timeoutSeconds: z.number().int().min(30).max(600).default(300),
});

export const apiRemoveInstance = z.object({
	instanceId: z.string().min(1),
	force: z.boolean().default(false),
});

export const apiRegisterNode = z.object({
	nodeId: z.string().min(1),
	registrationToken: z.string().min(1),
	publicIp: z.string().min(1),
	privateIp: z.string().optional(),
	hostname: z.string().optional(),
	dockerNodeId: z.string().optional(),
});

// ============================================================================
// Types
// ============================================================================

export type CloudProvider = typeof cloudProvider.$inferSelect;
export type NewCloudProvider = typeof cloudProvider.$inferInsert;
export type ProvisionedInstance = typeof provisionedInstance.$inferSelect;
export type NewProvisionedInstance = typeof provisionedInstance.$inferInsert;
export type ScalingJob = typeof scalingJob.$inferSelect;
export type NewScalingJob = typeof scalingJob.$inferInsert;
