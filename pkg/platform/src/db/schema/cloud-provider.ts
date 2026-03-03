/**
 * Cloud Provider Schema
 *
 * Enables Platform to provision and manage compute resources from cloud providers
 * like DigitalOcean, AWS, GCP, etc. This abstraction layer allows multi-cloud
 * deployments and automatic scaling of Platform clusters.
 *
 * Architecture:
 * - Organization -> has multiple CloudProviders (credentials)
 * - CloudProvider -> provisions ProvisionedDroplets
 * - ProvisionedDroplet -> links to ComputeNode (from compute-pool.ts)
 */

import { relations, sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";
import { computeNode, computePool } from "./compute-pool";

// ============================================================================
// Enums
// ============================================================================

export const cloudProviderType = pgEnum("cloud_provider_type", [
	"digitalocean",
	"aws",
	"gcp",
	"azure",
	"hetzner",
	"vultr",
	"linode",
]);

export const dropletStatus = pgEnum("droplet_status", [
	"pending",       // Record created, awaiting DO API call
	"provisioning",  // DO is creating the droplet
	"booting",       // Droplet created, running cloud-init
	"registering",   // Node is registering with Platform
	"running",       // Fully operational
	"draining",      // Workloads being migrated off
	"stopping",      // Shutting down
	"terminated",    // Deleted from DO
	"failed",        // Provisioning failed
]);

// ============================================================================
// Cloud Provider (Credentials & Config)
// ============================================================================

export const cloudProvider = pgTable(
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
		providerType: cloudProviderType("provider_type").notNull(),
		name: text("name").notNull(),
		slug: text("slug").notNull(),

		// Encrypted credentials (encrypted at application layer)
		credentials: jsonb("credentials")
			.$type<{
				apiToken?: string;         // DO API token (encrypted)
				accessKeyId?: string;      // AWS access key
				secretAccessKey?: string;  // AWS secret (encrypted)
				projectId?: string;        // GCP project ID
				region?: string;           // Default region
			}>()
			.notNull(),

		// Default configuration
		defaultRegion: text("default_region").notNull().default("nyc1"),
		defaultSize: text("default_size").notNull().default("s-2vcpu-4gb"),
		defaultImage: text("default_image").notNull().default("ubuntu-22-04-x64"),

		// VPC/Network configuration
		vpcConfig: jsonb("vpc_config")
			.$type<{
				vpcId?: string;
				subnetId?: string;
				securityGroupId?: string;
			}>(),

		// SSH key management
		sshKeyIds: text("ssh_key_ids")
			.array()
			.default(sql`ARRAY[]::text[]`),

		// Firewall configuration
		firewallId: text("firewall_id"),

		// Status
		isActive: boolean("is_active").notNull().default(true),
		lastValidated: timestamp("last_validated", { withTimezone: true }),
		validationError: text("validation_error"),

		// Metadata
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),

		// Timestamps
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => ({
		orgIdIdx: index("idx_cloud_provider_org").on(table.organizationId),
		typeIdx: index("idx_cloud_provider_type").on(table.providerType),
		slugIdx: index("idx_cloud_provider_slug").on(table.organizationId, table.slug),
	}),
);

// ============================================================================
// Provisioned Droplet (Cloud Instance Tracking)
// ============================================================================

export const provisionedDroplet = pgTable(
	"provisioned_droplet",
	{
		dropletId: text("droplet_id")
			.primaryKey()
			.$defaultFn(() => nanoid()),

		// Provider reference
		cloudProviderId: text("cloud_provider_id")
			.notNull()
			.references(() => cloudProvider.providerId, { onDelete: "cascade" }),

		// Pool reference (optional - some droplets may be standalone)
		poolId: text("pool_id")
			.references(() => computePool.poolId, { onDelete: "set null" }),

		// Compute node reference (created after registration)
		computeNodeId: text("compute_node_id")
			.references(() => computeNode.nodeId, { onDelete: "set null" }),

		// Provider-specific IDs
		externalId: text("external_id"),         // DO droplet ID, AWS instance ID, etc.
		externalName: text("external_name").notNull(),

		// Configuration
		region: text("region").notNull(),
		size: text("size").notNull(),
		image: text("image").notNull(),
		vpcId: text("vpc_id"),

		// Status
		status: dropletStatus("status").notNull().default("pending"),

		// Networking
		publicIp: text("public_ip"),
		privateIp: text("private_ip"),
		publicIpv6: text("public_ipv6"),

		// Bootstrap state
		registrationToken: text("registration_token"),
		registrationExpiry: timestamp("registration_expiry", { withTimezone: true }),
		swarmJoinToken: text("swarm_join_token"),

		// Resource specifications
		cpuCores: integer("cpu_cores").notNull(),
		memoryMb: integer("memory_mb").notNull(),
		storageGb: integer("storage_gb").notNull(),
		gpuCount: integer("gpu_count").default(0),

		// Cost tracking
		hourlyPrice: text("hourly_price"),      // Stored as string for precision
		monthlyPrice: text("monthly_price"),

		// Tags for organization
		tags: text("tags")
			.array()
			.default(sql`ARRAY[]::text[]`),

		// Error handling
		lastError: text("last_error"),
		errorCount: integer("error_count").notNull().default(0),

		// Metadata
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),

		// Timestamps
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
		registeredAt: timestamp("registered_at", { withTimezone: true }),
		terminatedAt: timestamp("terminated_at", { withTimezone: true }),
	},
	(table) => ({
		providerIdx: index("idx_provisioned_droplet_provider").on(table.cloudProviderId),
		poolIdx: index("idx_provisioned_droplet_pool").on(table.poolId),
		nodeIdx: index("idx_provisioned_droplet_node").on(table.computeNodeId),
		statusIdx: index("idx_provisioned_droplet_status").on(table.status),
		externalIdx: index("idx_provisioned_droplet_external").on(table.externalId),
	}),
);

// ============================================================================
// Scaling Job (Track Async Operations)
// ============================================================================

export const scalingJob = pgTable(
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
		config: jsonb("config")
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
		progress: integer("progress").notNull().default(0),      // 0-100

		// Results
		createdNodeIds: text("created_node_ids")
			.array()
			.default(sql`ARRAY[]::text[]`),
		removedNodeIds: text("removed_node_ids")
			.array()
			.default(sql`ARRAY[]::text[]`),

		// Error handling
		error: text("error"),
		errorDetails: jsonb("error_details"),

		// Timestamps
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		startedAt: timestamp("started_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
	},
	(table) => ({
		poolIdx: index("idx_scaling_job_pool").on(table.poolId),
		statusIdx: index("idx_scaling_job_status").on(table.status),
	}),
);

// ============================================================================
// Relations
// ============================================================================

export const cloudProviderRelations = relations(cloudProvider, ({ one, many }) => ({
	organization: one(organization, {
		fields: [cloudProvider.organizationId],
		references: [organization.id],
	}),
	droplets: many(provisionedDroplet),
	scalingJobs: many(scalingJob),
}));

export const provisionedDropletRelations = relations(provisionedDroplet, ({ one }) => ({
	cloudProvider: one(cloudProvider, {
		fields: [provisionedDroplet.cloudProviderId],
		references: [cloudProvider.providerId],
	}),
	pool: one(computePool, {
		fields: [provisionedDroplet.poolId],
		references: [computePool.poolId],
	}),
	computeNode: one(computeNode, {
		fields: [provisionedDroplet.computeNodeId],
		references: [computeNode.nodeId],
	}),
}));

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
	slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
});

export const apiConfigureCloudProvider = createProviderSchema.pick({
	name: true,
	slug: true,
	providerType: true,
	defaultRegion: true,
	defaultSize: true,
}).extend({
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

export const apiResizeDroplet = z.object({
	dropletId: z.string().min(1),
	newSize: z.string().min(1),
	resizeDisk: z.boolean().default(false),
});

export const apiDrainNode = z.object({
	nodeId: z.string().min(1),
	force: z.boolean().default(false),
	timeoutSeconds: z.number().int().min(30).max(600).default(300),
});

export const apiRemoveDroplet = z.object({
	dropletId: z.string().min(1),
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
export type ProvisionedDroplet = typeof provisionedDroplet.$inferSelect;
export type NewProvisionedDroplet = typeof provisionedDroplet.$inferInsert;
export type ScalingJob = typeof scalingJob.$inferSelect;
export type NewScalingJob = typeof scalingJob.$inferInsert;
