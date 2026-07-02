/**
 * /v1/org/{orgId}/cluster
 *   GET  — list the org's dedicated Hanzo K8S clusters.
 *   POST — provision a new dedicated cluster for the org (body: region?, ha?,
 *          nodeSize?, nodeCount?). The DO token is read from KMS server-side.
 *
 * The headless (service-token) mirror of the `dedicatedCluster` tRPC router, for
 * the console + automation. Auth: shared service bearer token
 * (PLATFORM_SERVICE_TOKEN | PAAS_SERVICE_TOKEN).
 */
import { apiProvisionDedicatedCluster } from "@hanzo/platform/db/schema";
import {
	listOrgClusters,
	provisionDedicatedCluster,
} from "@hanzo/platform/services/dedicated-cluster";
import { requireServiceToken } from "@/server/v1/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKENS = ["PLATFORM_SERVICE_TOKEN", "PAAS_SERVICE_TOKEN"] as const;

export async function GET(
	req: Request,
	ctx: { params: Promise<{ orgId: string }> },
) {
	const auth = requireServiceToken(req, TOKENS);
	if (!auth.ok) return auth.response;
	const { orgId } = await ctx.params;

	try {
		const clusters = await listOrgClusters(orgId);
		return Response.json(
			{ clusters },
			{ headers: { "Cache-Control": "no-cache" } },
		);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Cluster request failed";
		return Response.json({ message }, { status: 500 });
	}
}

export async function POST(
	req: Request,
	ctx: { params: Promise<{ orgId: string }> },
) {
	const auth = requireServiceToken(req, TOKENS);
	if (!auth.ok) return auth.response;
	const { orgId } = await ctx.params;

	try {
		// Force the org from the path; validate the rest.
		const raw = await req.json().catch(() => ({}));
		const body = typeof raw === "object" && raw ? raw : {};
		const parsed = apiProvisionDedicatedCluster.safeParse({
			...body,
			organizationId: orgId,
		});
		if (!parsed.success) {
			return Response.json(
				{ message: "Invalid request", issues: parsed.error.issues },
				{ status: 400 },
			);
		}
		const cluster = await provisionDedicatedCluster(parsed.data);
		return Response.json({ cluster }, { status: 201 });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Cluster request failed";
		return Response.json({ message }, { status: 500 });
	}
}
