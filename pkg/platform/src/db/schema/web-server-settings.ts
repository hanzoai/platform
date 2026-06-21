import { relations } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";

export const webServerSettings = sqliteTable("webServerSettings", {
	id: text("id")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	// Web Server Configuration
	serverIp: text("serverIp"),
	certificateType: text("certificateType", {
		enum: ["letsencrypt", "none", "custom"],
	})
		.notNull()
		.default("none"),
	https: integer("https", { mode: "boolean" }).notNull().default(false),
	host: text("host"),
	letsEncryptEmail: text("letsEncryptEmail"),
	sshPrivateKey: text("sshPrivateKey"),
	enableDockerCleanup: integer("enableDockerCleanup", { mode: "boolean" })
		.notNull()
		.default(true),
	logCleanupCron: text("logCleanupCron").default("0 0 * * *"),
	// Metrics Configuration
	metricsConfig: text("metricsConfig", { mode: "json" })
		.$type<{
			server: {
				type: "Hanzo Platform" | "Remote";
				refreshRate: number;
				port: number;
				token: string;
				urlCallback: string;
				retentionDays: number;
				cronJob: string;
				thresholds: {
					cpu: number;
					memory: number;
				};
			};
			containers: {
				refreshRate: number;
				services: {
					include: string[];
					exclude: string[];
				};
			};
		}>()
		.notNull()
		.default({
			server: {
				type: "Hanzo Platform",
				refreshRate: 60,
				port: 4500,
				token: "",
				retentionDays: 2,
				cronJob: "",
				urlCallback: "",
				thresholds: {
					cpu: 0,
					memory: 0,
				},
			},
			containers: {
				refreshRate: 60,
				services: {
					include: [],
					exclude: [],
				},
			},
		}),
	whitelabelingConfig: text("whitelabelingConfig", { mode: "json" })
		.$type<{
			appName: string | null;
			appDescription: string | null;
			logoUrl: string | null;
			faviconUrl: string | null;
			customCss: string | null;
			loginLogoUrl: string | null;
			supportUrl: string | null;
			docsUrl: string | null;
			errorPageTitle: string | null;
			errorPageDescription: string | null;
			metaTitle: string | null;
			footerText: string | null;
		}>()
		.default({
			appName: null,
			appDescription: null,
			logoUrl: null,
			faviconUrl: null,
			customCss: null,
			loginLogoUrl: null,
			supportUrl: null,
			docsUrl: null,
			errorPageTitle: null,
			errorPageDescription: null,
			metaTitle: null,
			footerText: null,
		}),
	remoteServersOnly: integer("remoteServersOnly", { mode: "boolean" })
		.notNull()
		.default(false),
	enforceSSO: integer("enforceSSO", { mode: "boolean" })
		.notNull()
		.default(false),
	// Cache Cleanup Configuration
	cleanupCacheApplications: integer("cleanupCacheApplications", {
		mode: "boolean",
	})
		.notNull()
		.default(false),
	cleanupCacheOnPreviews: integer("cleanupCacheOnPreviews", { mode: "boolean" })
		.notNull()
		.default(false),
	cleanupCacheOnCompose: integer("cleanupCacheOnCompose", { mode: "boolean" })
		.notNull()
		.default(false),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(
		() => new Date(),
	),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
});

export const webServerSettingsRelations = relations(
	webServerSettings,
	() => ({}),
);

const createSchema = createInsertSchema(webServerSettings, {
	id: z.string().min(1),
});

export const apiUpdateWebServerSettings = createSchema.partial().extend({
	serverIp: z.string().optional(),
	certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
	https: z.boolean().optional(),
	host: z.string().optional(),
	letsEncryptEmail: z.string().email().optional().nullable(),
	sshPrivateKey: z.string().optional(),
	enableDockerCleanup: z.boolean().optional(),
	logCleanupCron: z.string().optional().nullable(),
	metricsConfig: z
		.object({
			server: z.object({
				type: z.enum(["Hanzo Platform", "Remote"]),
				refreshRate: z.number(),
				port: z.number(),
				token: z.string(),
				urlCallback: z.string(),
				retentionDays: z.number(),
				cronJob: z.string(),
				thresholds: z.object({
					cpu: z.number(),
					memory: z.number(),
				}),
			}),
			containers: z.object({
				refreshRate: z.number(),
				services: z.object({
					include: z.array(z.string()),
					exclude: z.array(z.string()),
				}),
			}),
		})
		.optional(),
	cleanupCacheApplications: z.boolean().optional(),
	cleanupCacheOnPreviews: z.boolean().optional(),
	cleanupCacheOnCompose: z.boolean().optional(),
	remoteServersOnly: z.boolean().optional(),
	enforceSSO: z.boolean().optional(),
});

export const apiAssignDomain = z
	.object({
		host: z.string(),
		certificateType: z.enum(["letsencrypt", "none", "custom"]),
		letsEncryptEmail: z
			.union([z.string().email(), z.literal("")])
			.optional()
			.nullable(),
		https: z.boolean().optional(),
	})
	.required()
	.partial({
		letsEncryptEmail: true,
		https: true,
	});

export const apiSaveSSHKey = z
	.object({
		sshPrivateKey: z.string(),
	})
	.required();

export const apiUpdateDockerCleanup = z.object({
	enableDockerCleanup: z.boolean(),
	serverId: z.string().optional(),
});

// Whitelabeling validation schemas
const safeUrl = z
	.string()
	.refine((url) => /^https?:\/\//i.test(url), {
		message: "Only http:// and https:// URLs are allowed",
	})
	.nullable();

export const whitelabelingConfigSchema = z.object({
	appName: z.string().nullable(),
	appDescription: z.string().nullable(),
	logoUrl: safeUrl,
	faviconUrl: safeUrl,
	customCss: z.string().nullable(),
	loginLogoUrl: safeUrl,
	supportUrl: safeUrl,
	docsUrl: safeUrl,
	errorPageTitle: z.string().nullable(),
	errorPageDescription: z.string().nullable(),
	metaTitle: z.string().nullable(),
	footerText: z.string().nullable(),
});

export const apiUpdateWhitelabeling = z.object({
	whitelabelingConfig: whitelabelingConfigSchema,
});

export const apiUpdateWebServerMonitoring = z.object({
	metricsConfig: z
		.object({
			server: z.object({
				refreshRate: z.number().min(2),
				port: z.number().min(1),
				token: z.string(),
				urlCallback: z.string().url(),
				retentionDays: z.number().min(1),
				cronJob: z.string().min(1),
				thresholds: z.object({
					cpu: z.number().min(0),
					memory: z.number().min(0),
				}),
			}),
			containers: z.object({
				refreshRate: z.number().min(2),
				services: z.object({
					include: z.array(z.string()).optional(),
					exclude: z.array(z.string()).optional(),
				}),
			}),
		})
		.required(),
});
