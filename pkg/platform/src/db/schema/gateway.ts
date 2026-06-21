import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";

// ============================================================================
// Enums
// ============================================================================

// ============================================================================
// Tables
// ============================================================================

export const rateLimitRules = sqliteTable("rate_limit_rule", {
	rateLimitRuleId: text("rateLimitRuleId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	name: text("name").notNull(),
	scope: text("scope", { enum: ["global", "org", "user", "api-key"] })
		.notNull()
		.default("global"),
	scopeId: text("scopeId"),
	requestsPerMinute: integer("requestsPerMinute").notNull().default(60),
	burstSize: integer("burstSize").notNull().default(10),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	updatedAt: text("updatedAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const routingRules = sqliteTable("routing_rule", {
	routingRuleId: text("routingRuleId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	name: text("name").notNull(),
	host: text("host").notNull(),
	pathPrefix: text("pathPrefix"),
	backend: text("backend").notNull(),
	middlewares: text("middlewares", { mode: "json" })
		.$type<string[]>()
		.notNull()
		.default([]),
	priority: integer("priority").notNull().default(0),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	updatedAt: text("updatedAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

// ============================================================================
// Types
// ============================================================================

export type RateLimitRule = typeof rateLimitRules.$inferSelect;
export type RoutingRule = typeof routingRules.$inferSelect;

// ============================================================================
// Zod Schemas
// ============================================================================

const createRateLimitSchema = createInsertSchema(rateLimitRules, {
	name: z.string().min(1),
	requestsPerMinute: z.number().int().positive(),
	burstSize: z.number().int().positive(),
});

export const apiCreateRateLimitRule = createRateLimitSchema.pick({
	name: true,
	scope: true,
	scopeId: true,
	requestsPerMinute: true,
	burstSize: true,
	enabled: true,
});

export const apiUpdateRateLimitRule = createRateLimitSchema
	.pick({
		name: true,
		scope: true,
		scopeId: true,
		requestsPerMinute: true,
		burstSize: true,
		enabled: true,
	})
	.partial()
	.extend({
		rateLimitRuleId: z.string().min(1),
	});

export const apiFindRateLimitRule = createRateLimitSchema
	.pick({
		rateLimitRuleId: true,
	})
	.required();

const createRoutingRuleSchema = createInsertSchema(routingRules, {
	name: z.string().min(1),
	host: z.string().min(1),
	backend: z.string().min(1),
	priority: z.number().int().min(0),
});

export const apiCreateRoutingRule = createRoutingRuleSchema.pick({
	name: true,
	host: true,
	pathPrefix: true,
	backend: true,
	middlewares: true,
	priority: true,
	enabled: true,
});

export const apiUpdateRoutingRule = createRoutingRuleSchema
	.pick({
		name: true,
		host: true,
		pathPrefix: true,
		backend: true,
		middlewares: true,
		priority: true,
		enabled: true,
	})
	.partial()
	.extend({
		routingRuleId: z.string().min(1),
	});

export const apiFindRoutingRule = createRoutingRuleSchema
	.pick({
		routingRuleId: true,
	})
	.required();
