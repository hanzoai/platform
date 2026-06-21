import type { Application } from "@hanzo/platform/services/application";
import type { Mount } from "@hanzo/platform/services/mount";
import type { Port } from "@hanzo/platform/services/port";
import type { Project } from "@hanzo/platform/services/project";
import type { Registry } from "@hanzo/platform/services/registry";
import { relations } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { deployments } from "./deployment";

export const rollbacks = sqliteTable("rollback", {
	rollbackId: text("rollbackId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	deploymentId: text("deploymentId")
		.notNull()
		.references(() => deployments.deploymentId, {
			onDelete: "cascade",
		}),
	version: integer(),
	image: text("image"),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	fullContext: text("fullContext", { mode: "json" }).$type<
		Application & {
			environment: {
				project: Project;
			};
			mounts: Mount[];
			ports: Port[];
			registry?: Registry | null;
		}
	>(),
});

export type Rollback = typeof rollbacks.$inferSelect;

export const rollbacksRelations = relations(rollbacks, ({ one }) => ({
	deployment: one(deployments, {
		fields: [rollbacks.deploymentId],
		references: [deployments.deploymentId],
	}),
}));

export const createRollbackSchema = createInsertSchema(rollbacks).extend({
	appName: z.string().min(1),
});

export const updateRollbackSchema = createRollbackSchema.extend({
	rollbackId: z.string().min(1),
});

export const apiFindOneRollback = z.object({
	rollbackId: z.string().min(1),
});
