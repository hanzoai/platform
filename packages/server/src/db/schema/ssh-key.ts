import { relations } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { sshKeyCreate, sshKeyType } from "../validations";
import { organization } from "./account";
import { applications } from "./application";
import { compose } from "./compose";
import { server } from "./server";

export const sshKeys = pgTable("ssh-key", {
	sshKeyId: text("sshKeyId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	privateKey: text("privateKey").notNull().default(""),
	publicKey: text("publicKey").notNull(),
	name: text("name").notNull(),
	description: text("description"),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	lastUsedAt: text("lastUsedAt"),
	organizationId: text("organizationId")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
});

export const sshKeysRelations = relations(sshKeys, ({ many, one }) => ({
	applications: many(applications),
	compose: many(compose),
	servers: many(server),
	organization: one(organization, {
		fields: [sshKeys.organizationId],
		references: [organization.id],
	}),
}));

export const apiCreateSshKey = z.object({
	name: z.string().min(1),
	description: z.string().optional(),
	organizationId: z.string().min(1),
	publicKey: sshKeyCreate.shape.publicKey,
	privateKey: sshKeyCreate.shape.privateKey,
});

export const apiFindOneSshKey = z.object({
	sshKeyId: z.string().min(1),
});

export const apiGenerateSSHKey = sshKeyType;

export const apiRemoveSshKey = z.object({
	sshKeyId: z.string().min(1),
});

export const apiUpdateSshKey = z.object({
	sshKeyId: z.string().min(1),
	name: z.string().optional(),
	description: z.string().optional(),
	lastUsedAt: z.string().optional(),
});
