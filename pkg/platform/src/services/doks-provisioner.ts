import { db } from "@hanzo/platform/db";
import {
	doksCluster,
	doksNodePool,
	organization,
	type apiProvisionDoksCluster,
	type apiAddNodePool,
	type apiUpdateNodePool,
} from "@hanzo/platform/db/schema";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { recordUsageEvent } from "./billing";
import { requireKmsSecret } from "./kms";

// DigitalOcean droplet pricing in cents-per-hour. Source: DO public
// pricing as of 2026-06. Used by the usage-event callbacks below so
// commerce can debit the customer's Hanzo balance for the actual DO
// compute cost without surprising them with raw DO invoices. Update
// this map whenever DO publishes new sizes — the cost lookup falls back
// to 0 (free) for unknown sizes so a missing entry never silently
// charges the wrong amount.
const DO_NODE_SIZE_CENTS_PER_HOUR: Record<string, number> = {
	"s-1vcpu-2gb": 3,
	"s-2vcpu-2gb": 4,
	"s-2vcpu-4gb": 5,
	"s-4vcpu-8gb": 9,
	"s-8vcpu-16gb": 17,
	"s-2vcpu-8gb-amd": 7,
	"s-4vcpu-16gb-amd": 14,
	"s-8vcpu-32gb-amd": 28,
	"c-2": 9,
	"c-4": 18,
	"c-8": 36,
	"g-2vcpu-8gb": 8,
	"g-4vcpu-16gb": 16,
	"g-8vcpu-32gb": 32,
	"m-2vcpu-16gb": 16,
	"m-4vcpu-32gb": 32,
};

function nodeHourlyCents(size: string): number {
	return DO_NODE_SIZE_CENTS_PER_HOUR[size] ?? 0;
}

async function reportClusterUsage(
	organizationId: string,
	event:
		| "doks_provision"
		| "doks_destroy"
		| "doks_pool_add"
		| "doks_pool_remove"
		| "doks_pool_scale",
	properties: Record<string, unknown>,
) {
	try {
		await recordUsageEvent(organizationId, {
			subevent: event,
			provider: "digitalocean",
			...properties,
		});
	} catch (err) {
		console.warn(
			`recordUsageEvent failed (${event}, org ${organizationId}):`,
			(err as Error).message,
		);
	}
}

const DO_API = "https://api.digitalocean.com/v2";
const DEFAULT_REGION = process.env.PAAS_DEFAULT_REGION || "sfo3";
const DEFAULT_K8S_VERSION = process.env.PAAS_K8S_VERSION || "1.34.1-do.3";
const DEFAULT_NODE_SIZE = process.env.PAAS_DEFAULT_NODE_SIZE || "s-2vcpu-4gb";
const DEFAULT_NODE_COUNT = 2;

export type DoksCluster = typeof doksCluster.$inferSelect;
export type DoksNodePool = typeof doksNodePool.$inferSelect;

/**
 * DigitalOcean API headers. The DO API token's source of truth is KMS; it is
 * synced via the KMSSecret pipeline into the pod env as `PAAS_DO_API_TOKEN` and
 * read here through the single KMS funnel — never hardcoded. Reading it lazily
 * (per call, not at module load) lets a missing token fail loudly at the exact
 * provisioning call and lets the KMSSecret resync rotate it without a restart.
 */
function doHeaders() {
	return {
		Authorization: `Bearer ${requireKmsSecret("PAAS_DO_API_TOKEN")}`,
		"Content-Type": "application/json",
	};
}

async function doFetch<T>(
	path: string,
	options?: RequestInit,
): Promise<T> {
	const res = await fetch(`${DO_API}${path}`, {
		...options,
		headers: { ...doHeaders(), ...options?.headers },
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `DigitalOcean API error ${res.status}: ${body}`,
		});
	}
	if (res.status === 204) return {} as T;
	return res.json() as T;
}

// --- Cluster operations ---

export const provisionDoksCluster = async (
	input: z.infer<typeof apiProvisionDoksCluster>,
) => {
	const org = await db.query.organization.findFirst({
		where: eq(organization.id, input.organizationId),
	});
	if (!org) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Organization not found",
		});
	}

	const slug = `hanzo-${org.name.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 40)}`;
	const region = input.region || DEFAULT_REGION;
	const nodeSize = input.nodeSize || DEFAULT_NODE_SIZE;
	const nodeCount = input.nodeCount || DEFAULT_NODE_COUNT;

	const doBody = {
		name: slug,
		region,
		version: DEFAULT_K8S_VERSION,
		ha: input.ha || false,
		node_pools: [
			{
				size: nodeSize,
				name: `${slug}-pool`,
				count: nodeCount,
				auto_scale: true,
				min_nodes: 1,
				max_nodes: Math.max(nodeCount * 3, 6),
			},
		],
		auto_upgrade: true,
		surge_upgrade: true,
		maintenance_policy: {
			start_time: "04:00",
			day: "sunday",
		},
		tags: [`org:${input.organizationId}`, "hanzo-managed", "paas"],
	};

	const doResult = await doFetch<{ kubernetes_cluster: any }>(
		"/kubernetes/clusters",
		{ method: "POST", body: JSON.stringify(doBody) },
	);

	const doCluster = doResult.kubernetes_cluster;

	const insertData: any = {
		name: slug,
		doClusterId: doCluster.id,
		region,
		status: "provisioning",
		endpoint: doCluster.endpoint || null,
		k8sVersion: DEFAULT_K8S_VERSION,
		ha: input.ha || false,
		organizationId: input.organizationId,
		tags: doBody.tags,
	};

	const newCluster = await db
		.insert(doksCluster)
		.values(insertData)
		.returning()
		.then((v) => v[0]);

	if (!newCluster) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to save cluster record",
		});
	}

	// Persist node pool
	if (doCluster.node_pools?.[0]) {
		const doPool = doCluster.node_pools[0];
		const poolData: any = {
			doPoolId: doPool.id,
			name: doPool.name,
			size: doPool.size,
			count: doPool.count,
			minNodes: doPool.min_nodes || 1,
			maxNodes: doPool.max_nodes || 6,
			autoScale: true,
			doksClusterId: newCluster.doksClusterId,
			tags: ["hanzo-managed"],
		};
		await db.insert(doksNodePool).values(poolData);
	}

	// Tell commerce a cluster came online so the per-droplet-hour cost
	// can flow against the customer's Hanzo balance / welcome credit.
	// We send the first node pool's size + count + hourly cents so
	// commerce can amortize it across the billing period without
	// re-querying DO.
	await reportClusterUsage(input.organizationId, "doks_provision", {
		doks_cluster_id: newCluster.doksClusterId,
		do_cluster_id: doCluster.id,
		region,
		ha: input.ha || false,
		node_size: nodeSize,
		node_count: nodeCount,
		hourly_cents: nodeHourlyCents(nodeSize) * nodeCount,
		k8s_version: DEFAULT_K8S_VERSION,
	});

	return newCluster;
};

export const findDoksClusterById = async (doksClusterId: string) => {
	const cluster = await db.query.doksCluster.findFirst({
		where: eq(doksCluster.doksClusterId, doksClusterId),
		with: {
			nodePools: true,
			organization: true,
		},
	});
	if (!cluster) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "DOKS cluster not found",
		});
	}
	return cluster;
};

export const findDoksClusterByOrgId = async (organizationId: string) => {
	const cluster = await db.query.doksCluster.findFirst({
		where: eq(doksCluster.organizationId, organizationId),
		with: {
			nodePools: true,
		},
	});
	return cluster || null;
};

export const getDoksClusterStatus = async (doksClusterId: string) => {
	const cluster = await findDoksClusterById(doksClusterId);
	if (!cluster.doClusterId) {
		return cluster;
	}

	const doResult = await doFetch<{ kubernetes_cluster: any }>(
		`/kubernetes/clusters/${cluster.doClusterId}`,
	);
	const doCluster = doResult.kubernetes_cluster;

	const status = doCluster.status?.state === "running" ? "running" as const
		: doCluster.status?.state === "error" ? "error" as const
		: "provisioning" as const;

	const setData: any = {
		status,
		endpoint: doCluster.endpoint || cluster.endpoint,
	};
	await db
		.update(doksCluster)
		.set(setData)
		.where(eq(doksCluster.doksClusterId, doksClusterId));

	return { ...cluster, status, endpoint: doCluster.endpoint || cluster.endpoint };
};

export const getDoksKubeconfig = async (doksClusterId: string) => {
	const cluster = await findDoksClusterById(doksClusterId);
	if (!cluster.doClusterId) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Cluster not yet provisioned on DigitalOcean",
		});
	}

	const res = await fetch(
		`${DO_API}/kubernetes/clusters/${cluster.doClusterId}/kubeconfig`,
		{ headers: doHeaders() },
	);
	if (!res.ok) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Failed to fetch kubeconfig",
		});
	}
	return res.text();
};

export const deleteDoksCluster = async (doksClusterId: string) => {
	const cluster = await findDoksClusterById(doksClusterId);

	if (cluster.doClusterId) {
		await doFetch(
			`/kubernetes/clusters/${cluster.doClusterId}?destroy_associated_resources=true`,
			{ method: "DELETE" },
		);
	}

	const setData: any = { status: "deleted" };
	await db
		.update(doksCluster)
		.set(setData)
		.where(eq(doksCluster.doksClusterId, doksClusterId));

	// Stop the meter. Commerce uses this to close any open
	// per-droplet-hour billing rows for this cluster.
	await reportClusterUsage(cluster.organizationId, "doks_destroy", {
		doks_cluster_id: doksClusterId,
		do_cluster_id: cluster.doClusterId,
	});
};

// --- Node pool operations ---

export const addNodePool = async (
	input: z.infer<typeof apiAddNodePool>,
) => {
	const cluster = await findDoksClusterById(input.doksClusterId);
	if (!cluster.doClusterId) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Cluster not yet provisioned",
		});
	}

	const count = Number(input.count || DEFAULT_NODE_COUNT);
	const size = String(input.size || DEFAULT_NODE_SIZE);

	const doResult = await doFetch<{ node_pool: any }>(
		`/kubernetes/clusters/${cluster.doClusterId}/node_pools`,
		{
			method: "POST",
			body: JSON.stringify({
				size,
				name: input.name,
				count,
				auto_scale: true,
				min_nodes: 1,
				max_nodes: Math.max(count * 3, 6),
				tags: ["hanzo-managed"],
			}),
		},
	);

	const doPool = doResult.node_pool;

	const poolData: any = {
		doPoolId: doPool.id,
		name: input.name,
		size,
		count,
		minNodes: 1,
		maxNodes: Math.max(count * 3, 6),
		autoScale: true,
		doksClusterId: input.doksClusterId,
		tags: ["hanzo-managed"],
	};

	const newPool = await db
		.insert(doksNodePool)
		.values(poolData)
		.returning()
		.then((v) => v[0]);

	if (!newPool) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to save node pool record",
		});
	}

	await reportClusterUsage(cluster.organizationId, "doks_pool_add", {
		doks_cluster_id: input.doksClusterId,
		do_pool_id: doPool.id,
		node_size: size,
		node_count: count,
		hourly_cents: nodeHourlyCents(size) * count,
	});

	return newPool;
};

export const updateNodePool = async (
	input: z.infer<typeof apiUpdateNodePool>,
) => {
	const cluster = await findDoksClusterById(input.doksClusterId);
	const pool = await db.query.doksNodePool.findFirst({
		where: eq(doksNodePool.poolId, input.poolId),
	});

	if (!pool) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Node pool not found" });
	}

	if (cluster.doClusterId && pool.doPoolId) {
		const doBody: Record<string, any> = {
			auto_scale: true,
			min_nodes: 1,
			max_nodes: Math.max((input.count || pool.count || 2) * 3, 6),
		};
		if (input.count !== undefined) doBody.count = input.count;
		if (input.size !== undefined) doBody.size = input.size;

		await doFetch(
			`/kubernetes/clusters/${cluster.doClusterId}/node_pools/${pool.doPoolId}`,
			{ method: "PUT", body: JSON.stringify(doBody) },
		);
	}

	const updates: any = {};
	if (input.count !== undefined) updates.count = input.count;
	if (input.size !== undefined) updates.size = input.size;
	updates.maxNodes = Math.max((input.count || pool.count || 2) * 3, 6);

	const updated = await db
		.update(doksNodePool)
		.set(updates)
		.where(eq(doksNodePool.poolId, input.poolId))
		.returning()
		.then((v) => v[0]);

	if (updated) {
		await reportClusterUsage(cluster.organizationId, "doks_pool_scale", {
			doks_cluster_id: input.doksClusterId,
			do_pool_id: pool.doPoolId,
			node_size: updated.size,
			node_count: updated.count,
			hourly_cents: nodeHourlyCents(String(updated.size)) * Number(updated.count || 0),
		});
	}

	return updated;
};

export const deleteNodePool = async (doksClusterId: string, poolId: string) => {
	const cluster = await findDoksClusterById(doksClusterId);
	const pool = await db.query.doksNodePool.findFirst({
		where: eq(doksNodePool.poolId, poolId),
	});

	if (!pool) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Node pool not found" });
	}

	if (cluster.doClusterId && pool.doPoolId) {
		await doFetch(
			`/kubernetes/clusters/${cluster.doClusterId}/node_pools/${pool.doPoolId}`,
			{ method: "DELETE" },
		);
	}

	await db.delete(doksNodePool).where(eq(doksNodePool.poolId, poolId));
};

export const upgradeToHA = async (doksClusterId: string) => {
	const cluster = await findDoksClusterById(doksClusterId);
	if (!cluster.doClusterId) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Cluster not yet provisioned",
		});
	}

	await doFetch(`/kubernetes/clusters/${cluster.doClusterId}`, {
		method: "PUT",
		body: JSON.stringify({ ha: true }),
	});

	const setData: any = { ha: true };
	const updated = await db
		.update(doksCluster)
		.set(setData)
		.where(eq(doksCluster.doksClusterId, doksClusterId))
		.returning()
		.then((v) => v[0]);

	return updated;
};

// --- Fleet / listing operations ---

export const listDoksClusters = async () => {
	return db.query.doksCluster.findMany({
		with: {
			nodePools: true,
			organization: true,
		},
	});
};

export const syncDoksFleet = async () => {
	const doResult = await doFetch<{ kubernetes_clusters: any[] }>(
		"/kubernetes/clusters",
	);
	const doClusters = doResult.kubernetes_clusters || [];

	for (const doCluster of doClusters) {
		const existing = await db.query.doksCluster.findFirst({
			where: eq(doksCluster.doClusterId, doCluster.id),
		});

		if (existing) {
			const status = doCluster.status?.state === "running" ? "running" as const
				: doCluster.status?.state === "error" ? "error" as const
				: "provisioning" as const;

			const setData: any = {
				status,
				endpoint: doCluster.endpoint || existing.endpoint,
			};
			await db
				.update(doksCluster)
				.set(setData)
				.where(eq(doksCluster.doksClusterId, existing.doksClusterId));
		}
	}

	return { synced: doClusters.length };
};

export const listNodeSizes = async () => {
	const result = await doFetch<{ options: any }>("/kubernetes/options");
	return result.options;
};

export const listRegions = async () => {
	const result = await doFetch<{ regions: any[] }>("/regions");
	return result.regions.filter(
		(r: any) => r.available && r.features?.includes("kubernetes"),
	);
};

export const getDropletPricing = async (sizeSlug: string) => {
	const result = await doFetch<{ sizes: any[] }>("/sizes");
	const size = result.sizes.find((s: any) => s.slug === sizeSlug);
	if (!size) return null;
	return {
		slug: size.slug,
		priceMonthly: size.price_monthly,
		priceHourly: size.price_hourly,
		vcpus: size.vcpus,
		memory: size.memory,
		disk: size.disk,
		description: size.description,
	};
};
