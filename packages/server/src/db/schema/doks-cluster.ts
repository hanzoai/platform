import { relations } from "drizzle-orm";
import {
	boolean,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	real,
	text,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";

export const doksClusterStatus = pgEnum("doksClusterStatus", [
	"pending",
	"provisioning",
	"running",
	"error",
	"deleting",
	"deleted",
]);

export const doksCluster = pgTable("doks_cluster", {
	doksClusterId: text("doksClusterId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	name: text("name").notNull(),
	doClusterId: text("doClusterId"),
	region: text("region").notNull().default("sfo3"),
	status: doksClusterStatus("status").notNull().default("pending"),
	endpoint: text("endpoint"),
	k8sVersion: text("k8sVersion").default("1.34.1-do.3"),
	ha: boolean("ha").notNull().default(false),
	autoUpgrade: boolean("autoUpgrade").notNull().default(true),
	surgeUpgrade: boolean("surgeUpgrade").notNull().default(true),
	organizationId: text("organizationId")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	tags: text("tags")
		.array()
		.notNull()
		.default([]),
	maintenancePolicy: jsonb("maintenancePolicy")
		.$type<{ startTime: string; day: string }>()
		.default({ startTime: "04:00", day: "sunday" }),
});

export const doksClusterRelations = relations(doksCluster, ({ one, many }) => ({
	organization: one(organization, {
		fields: [doksCluster.organizationId],
		references: [organization.id],
	}),
	nodePools: many(doksNodePool),
}));

export const doksNodePool = pgTable("doks_node_pool", {
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
	autoScale: boolean("autoScale").notNull().default(true),
	doksClusterId: text("doksClusterId")
		.notNull()
		.references(() => doksCluster.doksClusterId, { onDelete: "cascade" }),
	tags: text("tags")
		.array()
		.notNull()
		.default([]),
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
	.partial({ organizationId: true })
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
