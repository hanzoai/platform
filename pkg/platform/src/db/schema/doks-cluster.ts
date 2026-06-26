import { relations, sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";

export const doksCluster = sqliteTable("doks_cluster", {
	doksClusterId: text("doksClusterId")

		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	name: text("name").notNull(),
	doClusterId: text("doClusterId"),
	region: text("region").notNull().default("sfo3"),
	status: text("status", {
		enum: [
			"pending",
			"provisioning",
			"running",
			"error",
			"deleting",
			"deleted",
		],
	})
		.notNull()
		.default("pending"),
	endpoint: text("endpoint"),
	k8sVersion: text("k8sVersion").default("1.34.1-do.3"),
	ha: integer("ha", { mode: "boolean" }).notNull().default(false),
	autoUpgrade: integer("autoUpgrade", { mode: "boolean" })
		.notNull()
		.default(true),
	surgeUpgrade: integer("surgeUpgrade", { mode: "boolean" })
		.notNull()
		.default(true),
	organizationId: text("organizationId")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	tags: text("tags", { mode: "json" })
		.$type<string[]>()
		.notNull()
		.default(sql`'[]'`),
	maintenancePolicy: text("maintenancePolicy", { mode: "json" })
		.$type<{ startTime: string; day: string }>()
		.default({ startTime: "04:00", day: "sunday" }),
	// --- Dedicated-cluster lifecycle (platform control-plane) ---
	// `status` mirrors DigitalOcean's own cluster state; `phase` is platform's
	// provisioning lifecycle (DOKS created → operator+baseline installed → ready
	// as a deploy target). They are orthogonal: a DO-`running` cluster is not a
	// usable Hanzo target until `phase=ready`.
	phase: text("phase", {
		enum: ["requested", "provisioning", "installing", "ready", "error"],
	})
		.notNull()
		.default("requested"),
	/** hanzo-operator (CRDs + controller) reconciled onto this cluster. */
	operatorInstalled: integer("operatorInstalled", { mode: "boolean" })
		.notNull()
		.default(false),
	/** Per-tenant baseline (namespaces, PaaS ticket secret, ingress/gateway). */
	baselineInstalled: integer("baselineInstalled", { mode: "boolean" })
		.notNull()
		.default(false),
	/** This cluster is the org's selected deploy target (≤1 active per org). */
	active: integer("active", { mode: "boolean" }).notNull().default(false),
	/** Last baseline-install failure, for surfacing/retry; null when healthy. */
	baselineError: text("baselineError"),
});

/** Canonical provisioning-phase vocabulary (single source for code + UI). */
export const doksPhaseValues = [
	"requested",
	"provisioning",
	"installing",
	"ready",
	"error",
] as const;
export type DoksPhase = (typeof doksPhaseValues)[number];

export const doksClusterRelations = relations(doksCluster, ({ one, many }) => ({
	organization: one(organization, {
		fields: [doksCluster.organizationId],
		references: [organization.id],
	}),
	nodePools: many(doksNodePool),
}));

export const doksNodePool = sqliteTable("doks_node_pool", {
	poolId: text("poolId")

		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	doPoolId: text("doPoolId"),
	name: text("name").notNull(),
	size: text("size").notNull().default("s-2vcpu-4gb"),
	count: integer("count").notNull().default(2),
	minNodes: integer("minNodes").notNull().default(1),
	maxNodes: integer("maxNodes").notNull().default(6),
	autoScale: integer("autoScale", { mode: "boolean" }).notNull().default(true),
	doksClusterId: text("doksClusterId")
		.notNull()
		.references(() => doksCluster.doksClusterId, { onDelete: "cascade" }),
	tags: text("tags", { mode: "json" })
		.$type<string[]>()
		.notNull()
		.default(sql`'[]'`),
});

export const doksNodePoolRelations = relations(doksNodePool, ({ one }) => ({
	cluster: one(doksCluster, {
		fields: [doksNodePool.doksClusterId],
		references: [doksCluster.doksClusterId],
	}),
}));

// --- Zod validation schemas ---

const createClusterSchema = createInsertSchema(doksCluster, {
	doksClusterId: z.string().min(1),
	name: z.string().min(1),
	region: z.string().min(1),
	organizationId: z.string().min(1),
});

export const apiProvisionDoksCluster = createClusterSchema
	.pick({
		organizationId: true,
		region: true,
		ha: true,
	})
	.required({ organizationId: true })
	.extend({
		nodeSize: z.string().optional(),
		nodeCount: z.number().int().min(1).optional(),
	});

export const apiFindOneDoksCluster = createClusterSchema
	.pick({
		doksClusterId: true,
	})
	.required();

export const apiDeleteDoksCluster = createClusterSchema
	.pick({
		doksClusterId: true,
	})
	.required();

const createNodePoolSchema = createInsertSchema(doksNodePool, {
	poolId: z.string().min(1),
	name: z.string().min(1),
	doksClusterId: z.string().min(1),
});

export const apiAddNodePool = createNodePoolSchema
	.pick({
		doksClusterId: true,
		name: true,
		size: true,
		count: true,
	})
	.required({ doksClusterId: true, name: true });

export const apiUpdateNodePool = z.object({
	doksClusterId: z.string().min(1),
	poolId: z.string().min(1),
	count: z.number().int().min(1).optional(),
	size: z.string().optional(),
});

export const apiDeleteNodePool = z.object({
	doksClusterId: z.string().min(1),
	poolId: z.string().min(1),
});

// --- Dedicated-cluster (control-plane) API schemas ---

/** Provision a dedicated Hanzo K8S cluster for an org (same shape as DOKS). */
export const apiProvisionDedicatedCluster = apiProvisionDoksCluster;

/** Reference a dedicated cluster by id (install baseline / status / select). */
export const apiDedicatedClusterRef = z.object({
	doksClusterId: z.string().min(1),
});

/** Select (or clear) an org's active deploy target. */
export const apiSelectDeployTarget = z.object({
	organizationId: z.string().min(1),
	/** The dedicated cluster to activate; omit/null to revert to the shared cluster. */
	doksClusterId: z.string().min(1).nullable().optional(),
});
