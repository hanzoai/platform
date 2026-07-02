/**
 * /v1/org/{orgId}/cluster/{clusterId}
 *   GET    — one cluster owned by the org (sealed kubeconfig redacted).
 *   DELETE — destroy the cluster. A managed DOKS cluster is torn down on
 *            DigitalOcean (associated resources included); an attached BYO
 *            cluster is detached (the record is marked deleted — platform never
 *            owned the external infra, so nothing is destroyed remotely).
 *
 * Every op is scoped to the org in the path: the cluster must belong to it or
 * the response is 404 (never reveal another tenant's cluster). The headless
 * (service-token) mirror of the cluster lifecycle for the console + automation.
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN | PAAS_SERVICE_TOKEN).
 */
import { redactCluster } from "@hanzo/platform/services/dedicated-cluster";
import {
	deleteDoksCluster,
	findDoksClusterById,
} from "@hanzo/platform/services/doks-provisioner";
import { requireServiceToken } from "@/server/v1/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKENS = ["PLATFORM_SERVICE_TOKEN", "PAAS_SERVICE_TOKEN"] as const;

export async function GET(
	req: Request,
	ctx: { params: Promise<{ orgId: string; clusterId: string }> },
) {
	const auth = requireServiceToken(req, TOKENS);
	if (!auth.ok) return auth.response;
	const { orgId, clusterId } = await ctx.params;

	try {
		// Scope guard: the cluster must belong to the org in the path.
		const cluster = await findDoksClusterById(clusterId);
		if (cluster.organizationId !== orgId) {
			return Response.json({ message: "Cluster not found" }, { status: 404 });
		}
		return Response.json(
			{ cluster: redactCluster(cluster) },
			{ headers: { "Cache-Control": "no-cache" } },
		);
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : "Cluster request failed";
		return Response.json({ message }, { status: 500 });
	}
}

export async function DELETE(
	req: Request,
	ctx: { params: Promise<{ orgId: string; clusterId: string }> },
) {
	const auth = requireServiceToken(req, TOKENS);
	if (!auth.ok) return auth.response;
	const { orgId, clusterId } = await ctx.params;

	try {
		// Scope guard: the cluster must belong to the org in the path.
		const cluster = await findDoksClusterById(clusterId);
		if (cluster.organizationId !== orgId) {
			return Response.json({ message: "Cluster not found" }, { status: 404 });
		}
		await deleteDoksCluster(clusterId);
		return Response.json({ deleted: true, doksClusterId: clusterId });
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : "Cluster request failed";
		return Response.json({ message }, { status: 500 });
	}
}
