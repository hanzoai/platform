import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { nanoid } from "nanoid";
import { projects } from "./project";
import { server } from "./server";
import { ssoProvider } from "./sso";
import { user } from "./user";

export const account = sqliteTable("account", {
	id: text("id")

		.primaryKey()
		.$defaultFn(() => nanoid()),
	accountId: text("account_id")
		.notNull()
		.$defaultFn(() => nanoid()),
	providerId: text("provider_id").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: integer("access_token_expires_at", {
		mode: "timestamp_ms",
	}),
	refreshTokenExpiresAt: integer("refresh_token_expires_at", {
		mode: "timestamp_ms",
	}),
	scope: text("scope"),
	password: text("password"),
	is2FAEnabled: integer("is2FAEnabled", { mode: "boolean" })
		.notNull()
		.default(false),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
	resetPasswordToken: text("resetPasswordToken"),
	resetPasswordExpiresAt: text("resetPasswordExpiresAt"),
	confirmationToken: text("confirmationToken"),
	confirmationExpiresAt: text("confirmationExpiresAt"),
});

export const accountRelations = relations(account, ({ one }) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id],
	}),
}));

export const verification = sqliteTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
	createdAt: integer("created_at", { mode: "timestamp_ms" }),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
});

export const organization = sqliteTable("organization", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => nanoid()),
	name: text("name").notNull(),
	slug: text("slug").unique(),
	logo: text("logo"),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	metadata: text("metadata"),
	ownerId: text("owner_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

export const organizationRelations = relations(
	organization,
	({ one, many }) => ({
		owner: one(user, {
			fields: [organization.ownerId],
			references: [user.id],
		}),
		servers: many(server),
		projects: many(projects),
		members: many(member),
		ssoProviders: many(ssoProvider),
		roles: many(organizationRole),
	}),
);

export const organizationRole = sqliteTable(
	"organization_role",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => nanoid()),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		role: text("role").notNull(),
		permission: text("permission").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$onUpdate(
			() => new Date(),
		),
	},
	(table) => [
		index("organizationRole_organizationId_idx").on(table.organizationId),
		index("organizationRole_role_idx").on(table.role),
	],
);

export const organizationRoleRelations = relations(
	organizationRole,
	({ one }) => ({
		organization: one(organization, {
			fields: [organizationRole.organizationId],
			references: [organization.id],
		}),
	}),
);

export const member = sqliteTable("member", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => nanoid()),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	role: text("role")
		.notNull()
		.$type<"owner" | "member" | "admin" | (string & {})>(),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	teamId: text("team_id"),
	isDefault: integer("is_default", { mode: "boolean" })
		.notNull()
		.default(false),
	// Permissions
	canCreateProjects: integer("canCreateProjects", { mode: "boolean" })
		.notNull()
		.default(false),
	canAccessToSSHKeys: integer("canAccessToSSHKeys", { mode: "boolean" })
		.notNull()
		.default(false),
	canCreateServices: integer("canCreateServices", { mode: "boolean" })
		.notNull()
		.default(false),
	canDeleteProjects: integer("canDeleteProjects", { mode: "boolean" })
		.notNull()
		.default(false),
	canDeleteServices: integer("canDeleteServices", { mode: "boolean" })
		.notNull()
		.default(false),
	canAccessToDocker: integer("canAccessToDocker", { mode: "boolean" })
		.notNull()
		.default(false),
	canAccessToAPI: integer("canAccessToAPI", { mode: "boolean" })
		.notNull()
		.default(false),
	canAccessToGitProviders: integer("canAccessToGitProviders", {
		mode: "boolean",
	})
		.notNull()
		.default(false),
	canAccessToTraefikFiles: integer("canAccessToTraefikFiles", {
		mode: "boolean",
	})
		.notNull()
		.default(false),
	canDeleteEnvironments: integer("canDeleteEnvironments", { mode: "boolean" })
		.notNull()
		.default(false),
	canCreateEnvironments: integer("canCreateEnvironments", { mode: "boolean" })
		.notNull()
		.default(false),
	accessedProjects: text("accesedProjects", { mode: "json" })
		.$type<string[]>()
		.notNull()
		.default(sql`'[]'`),
	accessedEnvironments: text("accessedEnvironments", { mode: "json" })
		.$type<string[]>()
		.notNull()
		.default(sql`'[]'`),
	accessedServices: text("accesedServices", { mode: "json" })
		.$type<string[]>()
		.notNull()
		.default(sql`'[]'`),
	accessedGitProviders: text("accessedGitProviders", { mode: "json" })
		.$type<string[]>()
		.notNull()
		.default(sql`'[]'`),
	accessedServers: text("accessedServers", { mode: "json" })
		.$type<string[]>()
		.notNull()
		.default(sql`'[]'`),
});

export const memberRelations = relations(member, ({ one }) => ({
	organization: one(organization, {
		fields: [member.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [member.userId],
		references: [user.id],
	}),
}));

export const invitation = sqliteTable("invitation", {
	id: text("id").primaryKey(),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	email: text("email").notNull(),
	role: text("role").$type<"owner" | "member" | "admin">(),
	status: text("status").notNull(),
	expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
	inviterId: text("inviter_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	teamId: text("team_id"),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.$defaultFn(() => new Date())
		.notNull(),
});

export const invitationRelations = relations(invitation, ({ one }) => ({
	organization: one(organization, {
		fields: [invitation.organizationId],
		references: [organization.id],
	}),
}));

export const twoFactor = sqliteTable("two_factor", {
	id: text("id").primaryKey(),
	secret: text("secret").notNull(),
	backupCodes: text("backup_codes").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

export const apikey = sqliteTable("apikey", {
	id: text("id").primaryKey(),
	name: text("name"),
	start: text("start"),
	prefix: text("prefix"),
	key: text("key").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	refillInterval: integer("refill_interval"),
	refillAmount: integer("refill_amount"),
	lastRefillAt: integer("last_refill_at", { mode: "timestamp_ms" }),
	enabled: integer("enabled", { mode: "boolean" }),
	rateLimitEnabled: integer("rate_limit_enabled", { mode: "boolean" }),
	rateLimitTimeWindow: integer("rate_limit_time_window"),
	rateLimitMax: integer("rate_limit_max"),
	requestCount: integer("request_count"),
	remaining: integer("remaining"),
	lastRequest: integer("last_request", { mode: "timestamp_ms" }),
	expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
	permissions: text("permissions"),
	metadata: text("metadata"),
});

export const apikeyRelations = relations(apikey, ({ one }) => ({
	user: one(user, {
		fields: [apikey.userId],
		references: [user.id],
	}),
}));
