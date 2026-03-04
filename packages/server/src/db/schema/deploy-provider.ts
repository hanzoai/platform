import { relations } from "drizzle-orm";
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";
import { projects } from "./project";

/**
 * Deploy Provider Credentials
 *
 * Org-scoped credentials for external hosting/deploy targets.
 * Supports Cloudflare Pages, Vercel, Netlify, AWS Amplify, etc.
 * Each org can have multiple providers; each project can override
 * the org default with a specific provider.
 */

export const deployProviderType = [
	"cloudflare-pages",
	"vercel",
	"netlify",
	"aws-amplify",
	"github-pages",
	"custom",
] as const;
export type DeployProviderType = (typeof deployProviderType)[number];

export const deployProvider = pgTable("deploy_provider", {
	deployProviderId: text("deployProviderId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	name: text("name").notNull(),
	providerType: text("providerType")
		.notNull()
		.$type<DeployProviderType>(),

	// Cloudflare: apiToken, accountId
	// Vercel: token, teamId
	// Netlify: token, siteId
	// AWS Amplify: accessKeyId, secretAccessKey, region
	// Generic: JSON blob
	apiToken: text("apiToken"),
	accountId: text("accountId"),
	// Extra credentials stored as JSON for provider-specific fields
	credentialsJson: text("credentialsJson"),

	isDefault: boolean("isDefault").notNull().default(false),

	organizationId: text("organizationId")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),

	createdAt: timestamp("createdAt").notNull().defaultNow(),
	updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export const deployProviderRelations = relations(
	deployProvider,
	({ one }) => ({
		organization: one(organization, {
			fields: [deployProvider.organizationId],
			references: [organization.id],
		}),
	}),
);

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const createSchema = createInsertSchema(deployProvider, {
	deployProviderId: z.string(),
	name: z.string().min(1),
	providerType: z.enum(deployProviderType),
	apiToken: z.string().optional(),
	accountId: z.string().optional(),
	credentialsJson: z.string().optional(),
	isDefault: z.boolean().optional(),
});

export const apiCreateDeployProvider = createSchema
	.pick({
		name: true,
		providerType: true,
		apiToken: true,
		accountId: true,
		credentialsJson: true,
		isDefault: true,
	})
	.required({ name: true, providerType: true });

export const apiFindOneDeployProvider = z.object({
	deployProviderId: z.string().min(1),
});

export const apiRemoveDeployProvider = z.object({
	deployProviderId: z.string().min(1),
});

export const apiUpdateDeployProvider = createSchema
	.pick({
		name: true,
		providerType: true,
		apiToken: true,
		accountId: true,
		credentialsJson: true,
		isDefault: true,
	})
	.partial()
	.extend({
		deployProviderId: z.string().min(1),
	});

export const apiTestDeployProvider = z.object({
	deployProviderId: z.string().min(1),
});
