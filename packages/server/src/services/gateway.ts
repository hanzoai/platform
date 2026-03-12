/**
 * Gateway Service
 *
 * Manages gateway configuration including rate limit rules and routing rules.
 * Provides health status checks for Traefik, Cloud API, and Bot Gateway.
 * Rules are stored in the platform's PostgreSQL database via Drizzle ORM.
 *
 * Features:
 * - Gateway component health monitoring
 * - Rate limit rule CRUD
 * - Routing rule CRUD
 */

import { db } from "@hanzo/platform/db";
import {
	type RateLimitRule,
	type RoutingRule,
	rateLimitRules,
	routingRules,
} from "@hanzo/platform/db/schema";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import type {
	apiCreateRateLimitRule,
	apiCreateRoutingRule,
	apiUpdateRateLimitRule,
	apiUpdateRoutingRule,
} from "../db/schema/gateway";

// ============================================================================
// Types — Gateway Status
// ============================================================================

export interface GatewayComponentStatus {
	healthy: boolean;
	error?: string;
}

export interface TraefikStatus extends GatewayComponentStatus {
	routerCount: number;
	serviceCount: number;
}

export interface CloudApiStatus extends GatewayComponentStatus {
	activeConnections: number;
}

export interface BotGatewayStatus extends GatewayComponentStatus {
	connectedNodes: number;
}

export interface GatewayStatus {
	traefik: TraefikStatus;
	cloudApi: CloudApiStatus;
	botGateway: BotGatewayStatus;
}

// ============================================================================
// Configuration
// ============================================================================

interface GatewayConfig {
	traefikUrl: string;
	cloudApiUrl: string;
	botGatewayUrl: string;
}

export function getGatewayConfig(): GatewayConfig {
	return {
		traefikUrl:
			process.env.GATEWAY_TRAEFIK_URL ??
			"http://traefik.kube-system.svc.cluster.local:8080",
		cloudApiUrl:
			process.env.GATEWAY_CLOUD_API_URL ??
			"http://cloud-api.hanzo.svc.cluster.local:8000",
		botGatewayUrl:
			process.env.GATEWAY_BOT_URL ??
			"http://bot-gateway.hanzo.svc.cluster.local:80",
	};
}

// ============================================================================
// Health — Internal Fetch Helper
// ============================================================================

async function fetchHealth<T>(url: string, timeoutMs = 5000): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		return (await response.json()) as T;
	} finally {
		clearTimeout(timer);
	}
}

// ============================================================================
// Health — Gateway Status
// ============================================================================

interface TraefikOverview {
	http?: { routers?: { total?: number }; services?: { total?: number } };
}

export async function getGatewayStatus(): Promise<GatewayStatus> {
	const config = getGatewayConfig();

	const [traefik, cloudApi, botGateway] = await Promise.all([
		getTraefikStatus(config.traefikUrl),
		getCloudApiStatus(config.cloudApiUrl),
		getBotGatewayStatus(config.botGatewayUrl),
	]);

	return { traefik, cloudApi, botGateway };
}

async function getTraefikStatus(baseUrl: string): Promise<TraefikStatus> {
	try {
		const overview = await fetchHealth<TraefikOverview>(
			`${baseUrl}/api/overview`,
		);
		return {
			healthy: true,
			routerCount: overview.http?.routers?.total ?? 0,
			serviceCount: overview.http?.services?.total ?? 0,
		};
	} catch (error) {
		return {
			healthy: false,
			routerCount: 0,
			serviceCount: 0,
			error: error instanceof Error ? error.message : "Unknown error",
		};
	}
}

async function getCloudApiStatus(baseUrl: string): Promise<CloudApiStatus> {
	try {
		const data = await fetchHealth<Record<string, unknown>>(
			`${baseUrl}/api/health`,
		);
		return {
			healthy: true,
			activeConnections:
				typeof data.activeConnections === "number"
					? data.activeConnections
					: 0,
		};
	} catch (error) {
		return {
			healthy: false,
			activeConnections: 0,
			error: error instanceof Error ? error.message : "Unknown error",
		};
	}
}

async function getBotGatewayStatus(
	baseUrl: string,
): Promise<BotGatewayStatus> {
	try {
		const data = await fetchHealth<Record<string, unknown>>(
			`${baseUrl}/health`,
		);
		return {
			healthy: true,
			connectedNodes:
				typeof data.connectedNodes === "number" ? data.connectedNodes : 0,
		};
	} catch (error) {
		return {
			healthy: false,
			connectedNodes: 0,
			error: error instanceof Error ? error.message : "Unknown error",
		};
	}
}

// ============================================================================
// Rate Limit Rules — CRUD
// ============================================================================

export async function listRateLimitRules(): Promise<RateLimitRule[]> {
	return db.select().from(rateLimitRules);
}

export async function findRateLimitRuleById(
	rateLimitRuleId: string,
): Promise<RateLimitRule> {
	const rule = await db.query.rateLimitRules.findFirst({
		where: eq(rateLimitRules.rateLimitRuleId, rateLimitRuleId),
	});

	if (!rule) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Rate limit rule not found",
		});
	}

	return rule;
}

export async function createRateLimitRule(
	input: z.infer<typeof apiCreateRateLimitRule>,
): Promise<RateLimitRule> {
	const [rule] = await db
		.insert(rateLimitRules)
		.values(input as any)
		.returning();

	if (!rule) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Failed to create rate limit rule",
		});
	}

	return rule;
}

export async function updateRateLimitRule(
	input: z.infer<typeof apiUpdateRateLimitRule>,
): Promise<RateLimitRule> {
	const { rateLimitRuleId, ...rest } = input;

	const [rule] = await db
		.update(rateLimitRules)
		.set({
			...rest,
			updatedAt: new Date().toISOString(),
		} as any)
		.where(eq(rateLimitRules.rateLimitRuleId, rateLimitRuleId))
		.returning();

	if (!rule) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Rate limit rule not found",
		});
	}

	return rule;
}

export async function deleteRateLimitRule(
	rateLimitRuleId: string,
): Promise<RateLimitRule> {
	const [rule] = await db
		.delete(rateLimitRules)
		.where(eq(rateLimitRules.rateLimitRuleId, rateLimitRuleId))
		.returning();

	if (!rule) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Rate limit rule not found",
		});
	}

	return rule;
}

// ============================================================================
// Routing Rules — CRUD
// ============================================================================

export async function listRoutingRules(): Promise<RoutingRule[]> {
	return db.select().from(routingRules);
}

export async function findRoutingRuleById(
	routingRuleId: string,
): Promise<RoutingRule> {
	const rule = await db.query.routingRules.findFirst({
		where: eq(routingRules.routingRuleId, routingRuleId),
	});

	if (!rule) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Routing rule not found",
		});
	}

	return rule;
}

export async function createRoutingRule(
	input: z.infer<typeof apiCreateRoutingRule>,
): Promise<RoutingRule> {
	const [rule] = await db
		.insert(routingRules)
		.values(input as any)
		.returning();

	if (!rule) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Failed to create routing rule",
		});
	}

	return rule;
}

export async function updateRoutingRule(
	input: z.infer<typeof apiUpdateRoutingRule>,
): Promise<RoutingRule> {
	const { routingRuleId, ...rest } = input;

	const [rule] = await db
		.update(routingRules)
		.set({
			...rest,
			updatedAt: new Date().toISOString(),
		} as any)
		.where(eq(routingRules.routingRuleId, routingRuleId))
		.returning();

	if (!rule) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Routing rule not found",
		});
	}

	return rule;
}

export async function deleteRoutingRule(
	routingRuleId: string,
): Promise<RoutingRule> {
	const [rule] = await db
		.delete(routingRules)
		.where(eq(routingRules.routingRuleId, routingRuleId))
		.returning();

	if (!rule) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Routing rule not found",
		});
	}

	return rule;
}
