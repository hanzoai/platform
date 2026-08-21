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
import { findApplicationById } from "@hanzo/platform/services/application";
import {
	appInScope,
	PAAS_NAMESPACE,
	requireServiceToken,
	resolveDeploymentName,
	restartWorkload,
} from "@/server/paas/container-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
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
		if (!app.appName) {
			return Response.json(
				{ ok: false, message: "Container has no workload name" },
				{ status: 409 },
			);
		}
		// Resolve the live Deployment (by name or app label). null => reachable
		// but no matching workload (404); a throw => k8s unreachable/RBAC (500).
		const deploymentName = await resolveDeploymentName(
			PAAS_NAMESPACE,
			app.appName,
		);
		if (!deploymentName) {
			return Response.json(
				{
					ok: false,
					message: `No Deployment found for '${app.appName}' in namespace '${PAAS_NAMESPACE}'`,
				},
				{ status: 404 },
			);
		}
		await restartWorkload(PAAS_NAMESPACE, deploymentName);
		return Response.json({ ok: true });
	} catch (err: any) {
		return Response.json(
			{ ok: false, message: err?.message || "Redeploy failed" },
			{ status: 500 },
		);
	}
}
