/**
 * GET /v1/org/{orgId}/project/{projectId}/env/{environmentId}/container/{containerId}/pipelines
 *
 * Lists a container's deployment history (`deployment` rows) as the
 * console's PipelineRun[]. Returns [] when the app has never been deployed
 * through platform's own deploy flow.
 *
 * Auth: shared service bearer token (PAAS_SERVICE_TOKEN).
 */
import { findApplicationById } from "@hanzo/platform/services/application";
import { findAllDeploymentsByApplicationId } from "@hanzo/platform/services/deployment";
import {
	appInScope,
	mapDeploymentToPipelineRun,
	requireServiceToken,
} from "@/server/paas/container-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
	req: Request,
	ctx: {
		params: Promise<{
			orgId: string;
			projectId: string;
			environmentId: string;
			containerId: string;
		}>;
	},
) {
	const auth = requireServiceToken(req);
	if (!auth.ok) return auth.response;
	const { orgId, projectId, environmentId, containerId } = await ctx.params;

	try {
		const app: any = await findApplicationById(containerId);
		if (!appInScope(app, orgId, projectId, environmentId)) {
			return Response.json({ message: "Container not found" }, { status: 404 });
		}
		const deployments = await findAllDeploymentsByApplicationId(containerId);
		return Response.json(
			(deployments as any[]).map(mapDeploymentToPipelineRun),
		);
	} catch (err: any) {
		const code = err?.code === "NOT_FOUND" ? 404 : 500;
		return Response.json(
			{ message: err?.message || "Failed to list pipelines" },
			{ status: code },
		);
	}
}
