/**
 * POST /v1/org/{orgId}/cluster/{clusterId}/install-baseline
 *
 * Install the hanzo-operator + per-tenant baseline (namespaces, PaaS-ticket
 * shared secret, ingress + gateway) onto a provisioned, running dedicated
 * cluster. The cluster's kubeconfig is derived on demand from DigitalOcean
 * (KMS DO token); nothing secret is stored.
 *
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN | PAAS_SERVICE_TOKEN).
 */
import { installClusterBaseline } from "@hanzo/platform/services/dedicated-cluster";
import { findDoksClusterById } from "@hanzo/platform/services/doks-provisioner";
import { requireServiceToken } from "@/server/v1/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKENS = ["PLATFORM_SERVICE_TOKEN", "PAAS_SERVICE_TOKEN"] as const;

export async function POST(
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
		const updated = await installClusterBaseline(clusterId);
		return Response.json({ cluster: updated });
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : "Baseline install failed";
		return Response.json({ message }, { status: 500 });
	}
}
