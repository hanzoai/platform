/**
 * POST /v1/org/{orgId}/project/{projectId}/env/{environmentId}/container/{containerId}/redeploy
 *
 * Redeploys a container. The platform-managed workloads run as k8s Deployments
 * (named == application.appName) reconciled by universe/ArgoCD, so "redeploy"
 * here is a rolling restart of that Deployment (re-pulls and recreates pods).
 * Returns { ok: true } — the console's triggerBuild only checks for a 2xx.
 *
 * Auth: shared service bearer token (PAAS_SERVICE_TOKEN).
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { findApplicationById } from "@hanzo/platform/services/application";
import {
	PAAS_NAMESPACE,
	appInScope,
	methodNotAllowed,
	requireParams,
	requireServiceToken,
	resolveDeploymentName,
	restartWorkload,
} from "@/server/paas/container-api";

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.method !== "POST") return methodNotAllowed(req, res, ["POST"]);
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
		if (!app.appName) {
			res
				.status(409)
				.json({ ok: false, message: "Container has no workload name" });
			return;
		}
		// Resolve the live Deployment (by name or app label). null => reachable
		// but no matching workload (404); a throw => k8s unreachable/RBAC (500).
		const deploymentName = await resolveDeploymentName(
			PAAS_NAMESPACE,
			app.appName,
		);
		if (!deploymentName) {
			res.status(404).json({
				ok: false,
				message: `No Deployment found for '${app.appName}' in namespace '${PAAS_NAMESPACE}'`,
			});
			return;
		}
		await restartWorkload(PAAS_NAMESPACE, deploymentName);
		res.status(200).json({ ok: true });
	} catch (err: any) {
		res
			.status(500)
			.json({ ok: false, message: err?.message || "Redeploy failed" });
	}
}
