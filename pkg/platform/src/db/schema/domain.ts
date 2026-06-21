import { randomInt } from "node:crypto";
import { relations, sql } from "drizzle-orm";
import {
	AnySQLiteColumn,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
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
	// to be a non-null integer that's unique within the namespace whose
	// Traefik router names embed it. `crypto.randomInt` (not `Math.random`)
	// so the value is not predictable; uniqueness within a namespace is
	// enforced by the partial indexes below, not by hoping a 31-bit random
	// never collides. `randomInt(min, max)` is max-EXCLUSIVE, so the ceiling
	// is `2**31` to cover the full unsigned 31-bit range [0, 2147483647].
	uniqueConfigKey: integer("uniqueConfigKey")
		.notNull()
		.$defaultFn(() => randomInt(0, 2_147_483_648)),
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
}, (table) => ({
	// The Traefik router name is `${appName}-${uniqueConfigKey}` (see
	// utils/docker/domain.ts and utils/traefik/domain.ts). Two domains
	// resolving to the same `appName` that share a `uniqueConfigKey` would
	// clobber each other's router — silently. `appName` is determined 1:1 by
	// exactly one discriminator: application domains by `applicationId`,
	// compose domains by `composeId` (→ `compose.appName`), preview domains
	// by `previewDeploymentId` (→ a per-preview random `appName`). Each
	// discriminator is therefore its own router-name namespace.
	//
	// SQLite treats NULL as distinct in a UNIQUE index, so a single
	// `(applicationId, uniqueConfigKey)` index does NOT constrain the
	// compose/preview rows (where `applicationId IS NULL`) against each
	// other — two compose domains under one `composeId`, or two domains under
	// one preview, could collide. Partial indexes scoped to each
	// discriminator's non-NULL rows close that hole: every row is constrained
	// within exactly the namespace whose router name embeds its key.
	uniqueConfigKeyPerApp: uniqueIndex("domain_unique_config_key_per_app")
		.on(table.applicationId, table.uniqueConfigKey)
		.where(sql`${table.applicationId} IS NOT NULL`),
	uniqueConfigKeyPerCompose: uniqueIndex(
		"domain_unique_config_key_per_compose",
	)
		.on(table.composeId, table.uniqueConfigKey)
		.where(sql`${table.composeId} IS NOT NULL`),
	uniqueConfigKeyPerPreview: uniqueIndex(
		"domain_unique_config_key_per_preview",
	)
		.on(table.previewDeploymentId, table.uniqueConfigKey)
		.where(sql`${table.previewDeploymentId} IS NOT NULL`),
}));

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
