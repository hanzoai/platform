import { relations } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { applications } from "./application";
import { compose } from "./compose";
import { libsql } from "./libsql";
import { mariadb } from "./mariadb";
import { mongo } from "./mongo";
import { mysql } from "./mysql";
import { postgres } from "./postgres";
import { redis } from "./redis";

export const mounts = sqliteTable("mount", {
	mountId: text("mountId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	type: text("type", { enum: ["bind", "volume", "file"] }).notNull(),
	hostPath: text("hostPath"),
	volumeName: text("volumeName"),
	filePath: text("filePath"),
	content: text("content"),
	serviceType: text("serviceType", {
		enum: [
			"application",
			"postgres",
			"mysql",
			"mariadb",
			"mongo",
			"redis",
			"compose",
			"libsql",
		],
	})
		.notNull()
		.default("application"),
	mountPath: text("mountPath").notNull(),
	applicationId: text("applicationId").references(
		() => applications.applicationId,
		{ onDelete: "cascade" },
	),
	postgresId: text("postgresId").references(() => postgres.postgresId, {
		onDelete: "cascade",
	}),
	mariadbId: text("mariadbId").references(() => mariadb.mariadbId, {
		onDelete: "cascade",
	}),
	mongoId: text("mongoId").references(() => mongo.mongoId, {
		onDelete: "cascade",
	}),
	mysqlId: text("mysqlId").references(() => mysql.mysqlId, {
		onDelete: "cascade",
	}),
	redisId: text("redisId").references(() => redis.redisId, {
		onDelete: "cascade",
	}),
	composeId: text("composeId").references(() => compose.composeId, {
		onDelete: "cascade",
	}),
	libsqlId: text("libsqlId").references(() => libsql.libsqlId, {
		onDelete: "cascade",
	}),
});

export const MountssRelations = relations(mounts, ({ one }) => ({
	application: one(applications, {
		fields: [mounts.applicationId],
		references: [applications.applicationId],
	}),
	postgres: one(postgres, {
		fields: [mounts.postgresId],
		references: [postgres.postgresId],
	}),
	mariadb: one(mariadb, {
		fields: [mounts.mariadbId],
		references: [mariadb.mariadbId],
	}),
	mongo: one(mongo, {
		fields: [mounts.mongoId],
		references: [mongo.mongoId],
	}),
	mysql: one(mysql, {
		fields: [mounts.mysqlId],
		references: [mysql.mysqlId],
	}),
	redis: one(redis, {
		fields: [mounts.redisId],
		references: [redis.redisId],
	}),
	compose: one(compose, {
		fields: [mounts.composeId],
		references: [compose.composeId],
	}),
	libsql: one(libsql, {
		fields: [mounts.libsqlId],
		references: [libsql.libsqlId],
	}),
}));

const createSchema = createInsertSchema(mounts, {
	applicationId: z.string(),
	type: z.enum(["bind", "volume", "file"]),
	hostPath: z.string().optional(),
	volumeName: z.string().optional(),
	content: z.string().optional(),
	mountPath: z.string().min(1),
	mountId: z.string().optional(),
	filePath: z.string().optional(),
	serviceType: z.enum([
		"application",
		"postgres",
		"mysql",
		"mariadb",
		"mongo",
		"redis",
		"compose",
		"libsql",
	]),
});

export type ServiceType = NonNullable<
	z.infer<typeof createSchema>["serviceType"]
>;

export const apiCreateMount = createSchema
	.pick({
		type: true,
		hostPath: true,
		volumeName: true,
		content: true,
		mountPath: true,
		serviceType: true,
		filePath: true,
	})
	.extend({
		serviceId: z.string().min(1),
	});

export const apiFindOneMount = z.object({
	mountId: z.string().min(1),
});

export const apiRemoveMount = createSchema
	.pick({
		mountId: true,
	})
	// .extend({
	// 	appName: z.string().min(1),
	// })
	.required();

export const apiFindMountByApplicationId = createSchema
	.extend({
		serviceId: z.string().min(1),
		serviceType: z.enum([
			"application",
			"postgres",
			"mysql",
			"mariadb",
			"mongo",
			"redis",
			"compose",
			"libsql",
		]),
	})
	.pick({
		serviceId: true,
		serviceType: true,
	});

export const apiUpdateMount = createSchema.partial().extend({
	mountId: z.string().min(1),
});
