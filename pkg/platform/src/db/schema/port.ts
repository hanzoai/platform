import { relations } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { applications } from "./application";

export const ports = sqliteTable("port", {
	portId: text("portId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	publishedPort: integer("publishedPort").notNull(),
	publishMode: text("publishMode", { enum: ["ingress", "host"] })
		.notNull()
		.default("host"),
	targetPort: integer("targetPort").notNull(),
	protocol: text("protocol", { enum: ["tcp", "udp"] }).notNull(),

	applicationId: text("applicationId")
		.notNull()
		.references(() => applications.applicationId, { onDelete: "cascade" }),
});

export const portsRelations = relations(ports, ({ one }) => ({
	application: one(applications, {
		fields: [ports.applicationId],
		references: [applications.applicationId],
	}),
}));

const createSchema = createInsertSchema(ports, {
	portId: z.string().min(1),
	applicationId: z.string().min(1),
	publishedPort: z.number(),
	publishMode: z.enum(["ingress", "host"]).default("ingress"),
	targetPort: z.number(),
	protocol: z.enum(["tcp", "udp"]).default("tcp"),
});

export const apiCreatePort = createSchema
	.pick({
		publishedPort: true,
		publishMode: true,
		targetPort: true,
		protocol: true,
		applicationId: true,
	})
	.required();

export const apiFindOnePort = z.object({
	portId: z.string().min(1),
});

export const apiUpdatePort = createSchema
	.pick({
		portId: true,
		publishedPort: true,
		publishMode: true,
		targetPort: true,
		protocol: true,
	})
	.required();
