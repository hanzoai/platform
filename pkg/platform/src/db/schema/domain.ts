import { relations, sql } from "drizzle-orm";
import {
	AnySQLiteColumn,
	integer,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { domain } from "../validations/domain";
import { applications } from "./application";
import { compose } from "./compose";
import { previewDeployments } from "./preview-deployments";

export const domains = sqliteTable("domain", {
	domainId: text("domainId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	host: text("host").notNull(),
	https: integer("https", { mode: "boolean" }).notNull().default(false),
	port: integer("port").default(3000),
	customEntrypoint: text("customEntrypoint"),
	path: text("path").default("/"),
	serviceName: text("serviceName"),
	domainType: text("domainType", {
		enum: ["compose", "application", "preview"],
	}).default("application"),
	// Postgres `serial` had no SQLite non-PK equivalent. This key only needs
	// to be a non-null integer that's unique within an app's Traefik router
	// names; a random 31-bit value satisfies both with no call-site changes.
	uniqueConfigKey: integer("uniqueConfigKey")
		.notNull()
		.$defaultFn(() => Math.floor(Math.random() * 2_147_483_647)),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	composeId: text("composeId").references(() => compose.composeId, {
		onDelete: "cascade",
	}),
	customCertResolver: text("customCertResolver"),
	applicationId: text("applicationId").references(
		() => applications.applicationId,
		{ onDelete: "cascade" },
	),
	previewDeploymentId: text("previewDeploymentId").references(
		(): AnySQLiteColumn => previewDeployments.previewDeploymentId,
		{ onDelete: "cascade" },
	),
	certificateType: text("certificateType", {
		enum: ["letsencrypt", "none", "custom"],
	})
		.notNull()
		.default("none"),
	internalPath: text("internalPath").default("/"),
	stripPath: integer("stripPath", { mode: "boolean" }).notNull().default(false),
	middlewares: text("middlewares", { mode: "json" })
		.$type<string[]>()
		.default(sql`'[]'`),
});

export const domainsRelations = relations(domains, ({ one }) => ({
	application: one(applications, {
		fields: [domains.applicationId],
		references: [applications.applicationId],
	}),
	compose: one(compose, {
		fields: [domains.composeId],
		references: [compose.composeId],
	}),
	previewDeployment: one(previewDeployments, {
		fields: [domains.previewDeploymentId],
		references: [previewDeployments.previewDeploymentId],
	}),
}));

const createSchema = createInsertSchema(domains, {
	...domain.shape,
	// Override pgEnum so Zod 4 infers only string literals, not numeric enum index
	domainType: z.enum(["compose", "application", "preview"]).optional(),
});

export const apiCreateDomain = createSchema.pick({
	host: true,
	path: true,
	port: true,
	customEntrypoint: true,
	https: true,
	applicationId: true,
	certificateType: true,
	customCertResolver: true,
	composeId: true,
	serviceName: true,
	domainType: true,
	previewDeploymentId: true,
	internalPath: true,
	stripPath: true,
	middlewares: true,
});

export const apiFindDomain = z.object({
	domainId: z.string().min(1),
});

export const apiFindDomainByApplication = createSchema.pick({
	applicationId: true,
});

export const apiCreateTraefikMeDomain = createSchema.pick({}).extend({
	appName: z.string().min(1),
});

export const apiFindDomainByCompose = createSchema.pick({
	composeId: true,
});

export const apiUpdateDomain = createSchema
	.pick({
		host: true,
		path: true,
		port: true,
		customEntrypoint: true,
		https: true,
		certificateType: true,
		customCertResolver: true,
		serviceName: true,
		domainType: true,
		internalPath: true,
		stripPath: true,
		middlewares: true,
	})
	.merge(createSchema.pick({ domainId: true }).required());
