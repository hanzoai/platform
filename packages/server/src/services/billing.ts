import { db } from "@hanzo/platform/db";
import {
	billingRecord,
	doksCluster,
	type CostItem,
} from "@hanzo/platform/db/schema";
import { eq } from "drizzle-orm";
import { getDropletPricing } from "./doks-provisioner";

const DOKS_BASE_COST = 12; // $12/mo base DOKS control plane
const HA_MONTHLY_COST = 40; // $40/mo additional for HA control plane
const MARKUP_PERCENT = parseFloat(process.env.PAAS_MARKUP_PERCENT || "0");

// Cache pricing lookups for 1 hour
const priceCache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000;

async function getCachedPricing(sizeSlug: string) {
	const cached = priceCache.get(sizeSlug);
	if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
	const data = await getDropletPricing(sizeSlug);
	if (data) priceCache.set(sizeSlug, { data, ts: Date.now() });
	return data;
}

export const calculateClusterCost = async (clusterId: string) => {
	const cluster = await db.query.doksCluster.findFirst({
		where: eq(doksCluster.doksClusterId, clusterId),
		with: {
			nodePools: true,
			organization: true,
		},
	});

	if (!cluster || cluster.status === "error") {
		return {
			monthlyTotal: 0,
			subtotal: 0,
			markup: 0,
			markupPercent: 0,
			items: [] as CostItem[],
			currency: "USD",
			calculatedAt: new Date().toISOString(),
		};
	}

	const items: CostItem[] = [];

	// Node pool costs
	for (const pool of cluster.nodePools) {
		const pricing = await getCachedPricing(pool.size);
		if (pricing) {
			const poolCost = pricing.priceMonthly * pool.count;
			items.push({
				type: "nodes",
				pool: pool.name,
				size: pool.size,
				count: pool.count,
				unitPrice: pricing.priceMonthly,
				monthlyTotal: poolCost,
				vcpus: pricing.vcpus * pool.count,
				memoryMb: pricing.memory * pool.count,
				diskGb: pricing.disk * pool.count,
			});
		}
	}

	// DOKS control plane base cost
	items.push({ type: "control_plane", monthlyTotal: DOKS_BASE_COST });

	// HA control plane surcharge
	if (cluster.ha) {
		items.push({ type: "ha_control_plane", monthlyTotal: HA_MONTHLY_COST });
	}

	const subtotal = items.reduce((sum, i) => sum + i.monthlyTotal, 0);
	const markup = subtotal * (MARKUP_PERCENT / 100);
	const monthlyTotal = subtotal + markup;

	return {
		organizationId: cluster.organizationId,
		organizationName: cluster.organization?.name,
		clusterId: cluster.doksClusterId,
		clusterName: cluster.name,
		region: cluster.region,
		status: cluster.status,
		items,
		subtotal,
		markupPercent: MARKUP_PERCENT,
		markup,
		monthlyTotal,
		currency: "USD",
		calculatedAt: new Date().toISOString(),
	};
};

export const getOrgBilling = async (organizationId: string) => {
	const cluster = await db.query.doksCluster.findFirst({
		where: eq(doksCluster.organizationId, organizationId),
	});
	if (!cluster) {
		return {
			organizationId,
			monthlyTotal: 0,
			subtotal: 0,
			markup: 0,
			markupPercent: 0,
			items: [] as CostItem[],
			currency: "USD",
			calculatedAt: new Date().toISOString(),
		};
	}
	return calculateClusterCost(cluster.doksClusterId);
};

export const getFleetBilling = async () => {
	const clusters = await db.query.doksCluster.findMany({
		with: { nodePools: true, organization: true },
	});

	const results = await Promise.all(
		clusters.map((c) => calculateClusterCost(c.doksClusterId)),
	);

	const totalMonthly = results.reduce((sum, r) => sum + r.monthlyTotal, 0);
	const totalNodes = results.reduce(
		(sum, r) =>
			sum +
			r.items
				.filter((i) => i.type === "nodes")
				.reduce((s, i) => s + (i.count || 0), 0),
		0,
	);
	const totalVcpus = results.reduce(
		(sum, r) =>
			sum +
			r.items
				.filter((i) => i.type === "nodes")
				.reduce((s, i) => s + (i.vcpus || 0), 0),
		0,
	);
	const totalMemoryMb = results.reduce(
		(sum, r) =>
			sum +
			r.items
				.filter((i) => i.type === "nodes")
				.reduce((s, i) => s + (i.memoryMb || 0), 0),
		0,
	);

	return {
		organizations: results,
		summary: {
			totalOrgs: results.length,
			totalMonthly,
			totalNodes,
			totalVcpus,
			totalMemoryGb: Math.round(totalMemoryMb / 1024),
			currency: "USD",
			calculatedAt: new Date().toISOString(),
		},
	};
};

export const recordBillingSnapshot = async (organizationId: string) => {
	const cost = await getOrgBilling(organizationId);

	const cluster = await db.query.doksCluster.findFirst({
		where: eq(doksCluster.organizationId, organizationId),
	});

	const insertData: any = {
		organizationId,
		doksClusterId: cluster?.doksClusterId || null,
		monthlyTotal: cost.monthlyTotal,
		subtotal: cost.subtotal,
		markup: cost.markup,
		markupPercent: cost.markupPercent,
		items: cost.items,
	};

	const record = await db
		.insert(billingRecord)
		.values(insertData)
		.returning()
		.then((v) => v[0]);

	return record;
};

export const recordUsageEvent = async (
	organizationId: string,
	eventData: Record<string, any>,
) => {
	const endpoint = process.env.PAAS_USAGE_ENDPOINT;
	if (!endpoint) return;

	try {
		await fetch(endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				organization_id: organizationId,
				event: "infrastructure_usage",
				timestamp: new Date().toISOString(),
				properties: eventData,
			}),
			signal: AbortSignal.timeout(5000),
		});
	} catch (err: any) {
		console.warn(
			`Usage tracking failed for org ${organizationId}:`,
			err.message,
		);
	}
};
