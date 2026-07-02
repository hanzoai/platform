/**
 * /v1/org/{orgId}/cluster/select
 *   GET  — the org's current resolved deploy target (kubeconfig redacted).
 *   POST — select the active deploy target (body: { doksClusterId } to point at
 *          a dedicated cluster, or { doksClusterId: null } to revert to shared).
 *
 * This is the "re-point the operator target" control: after selecting a
 * dedicated cluster, `resolveOrgClusterTarget` (used by operator-apply +
 * inventory) returns it, so subsequent deploys land on the dedicated cluster.
 *
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN | PAAS_SERVICE_TOKEN).
 */
import {
	redactTarget,
	resolveOrgClusterTarget,
	selectDeployTarget,
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
		const target = redactTarget(await resolveOrgClusterTarget(orgId));
		return Response.json(
			{ target },
			{ headers: { "Cache-Control": "no-cache" } },
		);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Select target failed";
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
		const raw = await req.json().catch(() => ({}));
		const body = typeof raw === "object" && raw ? raw : {};
		const clusterId = (body as { doksClusterId?: unknown }).doksClusterId;
		if (clusterId !== null && typeof clusterId !== "string") {
			return Response.json(
				{
					message:
						"doksClusterId must be a string, or null to revert to shared",
				},
				{ status: 400 },
			);
		}
		await selectDeployTarget(orgId, clusterId ?? null);
		const target = redactTarget(await resolveOrgClusterTarget(orgId));
		return Response.json(
			{ target },
			{ headers: { "Cache-Control": "no-cache" } },
		);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Select target failed";
		return Response.json({ message }, { status: 500 });
	}
}
