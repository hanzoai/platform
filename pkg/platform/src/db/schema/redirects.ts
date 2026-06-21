import { randomInt } from "node:crypto";
import { relations } from "drizzle-orm";
import {
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
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
	// names. `crypto.randomInt` (not `Math.random`) so the value is not
	// predictable; uniqueness within an app is enforced by the
	// `redirect_unique_config_key_per_app` index below. `randomInt(min, max)`
	// is max-EXCLUSIVE, so the ceiling is `2**31` to cover the full unsigned
	// 31-bit range [0, 2147483647].
	uniqueConfigKey: integer("uniqueConfigKey")
		.notNull()
		.$defaultFn(() => randomInt(0, 2_147_483_648)),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	applicationId: text("applicationId")
		.notNull()
		.references(() => applications.applicationId, { onDelete: "cascade" }),
}, (table) => ({
	// Same router-name contention as `domain`: a redirect's `uniqueConfigKey`
	// names its Traefik router within the application. `applicationId` is
	// NOT NULL here, so every redirect is constrained.
	uniqueConfigKeyPerApp: uniqueIndex("redirect_unique_config_key_per_app").on(
		table.applicationId,
		table.uniqueConfigKey,
	),
}));

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
