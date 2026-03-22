/**
 * Gateway Service
 *
 * Manages gateway configuration including rate limit rules and routing rules.
 * Provides health status checks for Traefik, Cloud API, and Bot Gateway.
 * Rules are stored in the platform's PostgreSQL database via Drizzle ORM.
 *
 * After every mutating operation, rules are synced to K8s:
 * - Rate limit rules → Traefik Middleware CRDs (traefik.io/v1alpha1)
 * - Routing rules → K8s Ingress resources (networking.k8s.io/v1)
 *
 * Features:
 * - Gateway component health monitoring
 * - Rate limit rule CRUD with K8s enforcement
 * - Routing rule CRUD with K8s enforcement
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
import { getDefaultClients, type K8sClients } from "./k8s/k8s-client";

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
// K8s Sync — Helpers
// ============================================================================

const GATEWAY_NAMESPACE = process.env.GATEWAY_K8S_NAMESPACE ?? "hanzo";
const MANAGED_BY_LABEL = "hanzo-platform";
const TRAEFIK_CRD_GROUP = "traefik.io";
const TRAEFIK_CRD_VERSION = "v1alpha1";

function getK8sClients(): K8sClients | null {
	try {
		return getDefaultClients();
	} catch {
		console.warn("[gateway] K8s not available — skipping sync");
		return null;
	}
}

function k8sError(err: unknown): string {
	const e = err as { response?: { body?: { message?: string } }; message?: string };
	return e.response?.body?.message ?? e.message ?? String(err);
}

// ============================================================================
// K8s Sync — Rate Limit → Traefik Middleware CRD
// ============================================================================

function buildRateLimitMiddleware(rule: RateLimitRule): Record<string, unknown> {
	return {
		apiVersion: `${TRAEFIK_CRD_GROUP}/${TRAEFIK_CRD_VERSION}`,
		kind: "Middleware",
		metadata: {
			name: `rate-limit-${rule.rateLimitRuleId}`,
			namespace: GATEWAY_NAMESPACE,
			labels: { "managed-by": MANAGED_BY_LABEL },
		},
		spec: {
			rateLimit: {
				average: Math.max(1, Math.round(rule.requestsPerMinute / 60)),
				burst: rule.burstSize,
			},
		},
	};
}

async function syncRateLimitToK8s(rule: RateLimitRule): Promise<void> {
	const clients = getK8sClients();
	if (!clients) return;

	const name = `rate-limit-${rule.rateLimitRuleId}`;
	const body = buildRateLimitMiddleware(rule);

	try {
		// Try to get existing — if found, replace; otherwise create.
		await clients.custom.getNamespacedCustomObject({
			group: TRAEFIK_CRD_GROUP,
			version: TRAEFIK_CRD_VERSION,
			namespace: GATEWAY_NAMESPACE,
			plural: "middlewares",
			name,
		});
		await clients.custom.replaceNamespacedCustomObject({
			group: TRAEFIK_CRD_GROUP,
			version: TRAEFIK_CRD_VERSION,
			namespace: GATEWAY_NAMESPACE,
			plural: "middlewares",
			name,
			body,
		});
	} catch {
		try {
			await clients.custom.createNamespacedCustomObject({
				group: TRAEFIK_CRD_GROUP,
				version: TRAEFIK_CRD_VERSION,
				namespace: GATEWAY_NAMESPACE,
				plural: "middlewares",
				body,
			});
		} catch (err) {
			console.error(`[gateway] Failed to sync rate limit '${name}' to K8s: ${k8sError(err)}`);
		}
	}
}

async function deleteRateLimitFromK8s(rateLimitRuleId: string): Promise<void> {
	const clients = getK8sClients();
	if (!clients) return;

	const name = `rate-limit-${rateLimitRuleId}`;
	try {
		await clients.custom.deleteNamespacedCustomObject({
			group: TRAEFIK_CRD_GROUP,
			version: TRAEFIK_CRD_VERSION,
			namespace: GATEWAY_NAMESPACE,
			plural: "middlewares",
			name,
		});
	} catch {
		// Idempotent — already gone
	}
}

// ============================================================================
// K8s Sync — Routing Rule → Ingress
// ============================================================================

function buildRoutingIngress(rule: RoutingRule): Record<string, unknown> {
	const annotations: Record<string, string> = {
		"kubernetes.io/ingress.class": "ingress",
		"traefik.ingress.kubernetes.io/router.entrypoints": "websecure",
		"traefik.ingress.kubernetes.io/router.tls": "true",
		"managed-by": MANAGED_BY_LABEL,
	};

	if (rule.middlewares && rule.middlewares.length > 0) {
		annotations["traefik.ingress.kubernetes.io/router.middlewares"] =
			rule.middlewares.join(",");
	}

	return {
		apiVersion: "networking.k8s.io/v1",
		kind: "Ingress",
		metadata: {
			name: `platform-route-${rule.routingRuleId}`,
			namespace: GATEWAY_NAMESPACE,
			labels: { "managed-by": MANAGED_BY_LABEL },
			annotations,
		},
		spec: {
			ingressClassName: "ingress",
			rules: [
				{
					host: rule.host,
					http: {
						paths: [
							{
								path: rule.pathPrefix || "/",
								pathType: "Prefix",
								backend: {
									service: {
										name: rule.backend,
										port: { number: 80 },
									},
								},
							},
						],
					},
				},
			],
		},
	};
}

async function syncRoutingRuleToK8s(rule: RoutingRule): Promise<void> {
	const clients = getK8sClients();
	if (!clients) return;

	const name = `platform-route-${rule.routingRuleId}`;
	const body = buildRoutingIngress(rule);

	try {
		const existing = await clients.networking.readNamespacedIngress({ name, namespace: GATEWAY_NAMESPACE });
		if (existing) {
			await clients.networking.replaceNamespacedIngress({
				name,
				namespace: GATEWAY_NAMESPACE,
				body: body as any,
			});
			return;
		}
	} catch {
		// Not found — fall through to create
	}

	try {
		await clients.networking.createNamespacedIngress({
			namespace: GATEWAY_NAMESPACE,
			body: body as any,
		});
	} catch (err) {
		console.error(`[gateway] Failed to sync routing rule '${name}' to K8s: ${k8sError(err)}`);
	}
}

async function deleteRoutingRuleFromK8s(routingRuleId: string): Promise<void> {
	const clients = getK8sClients();
	if (!clients) return;

	const name = `platform-route-${routingRuleId}`;
	try {
		await clients.networking.deleteNamespacedIngress({ name, namespace: GATEWAY_NAMESPACE });
	} catch {
		// Idempotent — already gone
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

	if (rule.enabled) {
		await syncRateLimitToK8s(rule);
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

	if (rule.enabled) {
		await syncRateLimitToK8s(rule);
	} else {
		await deleteRateLimitFromK8s(rule.rateLimitRuleId);
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

	await deleteRateLimitFromK8s(rateLimitRuleId);

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

	if (rule.enabled) {
		await syncRoutingRuleToK8s(rule);
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

	if (rule.enabled) {
		await syncRoutingRuleToK8s(rule);
	} else {
		await deleteRoutingRuleFromK8s(rule.routingRuleId);
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

	await deleteRoutingRuleFromK8s(routingRuleId);

	return rule;
}
