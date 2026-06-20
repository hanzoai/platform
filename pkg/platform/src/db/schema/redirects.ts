import { relations } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { applications } from "./application";

export const redirects = sqliteTable("redirect", {
	redirectId: text("redirectId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	regex: text("regex").notNull(),
	replacement: text("replacement").notNull(),
	permanent: integer("permanent", { mode: "boolean" }).notNull().default(false),
	// Postgres `serial` had no SQLite non-PK equivalent. This key only needs
	// to be a non-null integer that's unique within an app's Traefik router
	// names; a random 31-bit value satisfies both with no call-site changes.
	uniqueConfigKey: integer("uniqueConfigKey")
		.notNull()
		.$defaultFn(() => Math.floor(Math.random() * 2_147_483_647)),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	applicationId: text("applicationId")
		.notNull()
		.references(() => applications.applicationId, { onDelete: "cascade" }),
});

export const redirectRelations = relations(redirects, ({ one }) => ({
	application: one(applications, {
		fields: [redirects.applicationId],
		references: [applications.applicationId],
	}),
}));
const createSchema = createInsertSchema(redirects, {
	redirectId: z.string().min(1),
	regex: z.string().min(1),
	replacement: z.string().min(1),
	permanent: z.boolean().optional(),
});

export const apiFindOneRedirect = z.object({
	redirectId: z.string().min(1),
});

export const apiCreateRedirect = createSchema
	.pick({
		regex: true,
		replacement: true,
		permanent: true,
		applicationId: true,
	})
	.required();

export const apiUpdateRedirect = createSchema
	.pick({
		redirectId: true,
		regex: true,
		replacement: true,
		permanent: true,
	})
	.required();
