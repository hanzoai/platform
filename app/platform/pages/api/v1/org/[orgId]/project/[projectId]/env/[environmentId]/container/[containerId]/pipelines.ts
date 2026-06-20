/**
 * GET /v1/org/{orgId}/project/{projectId}/env/{environmentId}/container/{containerId}/pipelines
 *
 * Lists a container's deployment history (Dokploy `deployment` rows) as the
 * console's PipelineRun[]. Returns [] when the app has never been deployed
 * through platform's own deploy flow.
 *
 * Auth: shared service bearer token (PAAS_SERVICE_TOKEN).
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { findApplicationById } from "@hanzo/platform/services/application";
import { findAllDeploymentsByApplicationId } from "@hanzo/platform/services/deployment";
import {
	appInScope,
	mapDeploymentToPipelineRun,
	methodNotAllowed,
	requireParams,
	requireServiceToken,
} from "@/server/paas/container-api";

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.method !== "GET") return methodNotAllowed(req, res, ["GET"]);
	if (!requireServiceToken(req, res)) return;

	const params = requireParams(req, res, [
		"orgId",
		"projectId",
		"environmentId",
		"containerId",
	]);
	if (!params) return;
	const { orgId, projectId, environmentId, containerId } = params;

	try {
		const app: any = await findApplicationById(containerId);
		if (!appInScope(app, orgId, projectId, environmentId)) {
			res.status(404).json({ message: "Container not found" });
			return;
		}
		const deployments = await findAllDeploymentsByApplicationId(containerId);
		res.status(200).json((deployments as any[]).map(mapDeploymentToPipelineRun));
	} catch (err: any) {
		const code = err?.code === "NOT_FOUND" ? 404 : 500;
		res
			.status(code)
			.json({ message: err?.message || "Failed to list pipelines" });
	}
}
