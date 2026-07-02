/**
 * GET /v1/org/{orgId}/project/{projectId}/env/{environmentId}/container/{containerId}
 *
 * Returns one container (Dokploy application) as the console's PaasContainer.
 *
 * Auth: shared service bearer token (PAAS_SERVICE_TOKEN).
 */
import { findApplicationById } from "@hanzo/platform/services/application";
import {
	PAAS_NAMESPACE,
	appInScope,
	getLiveIndex,
	mapApplicationToContainer,
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
		const live = await getLiveIndex(PAAS_NAMESPACE);
		return Response.json(mapApplicationToContainer(app, live[app.appName]));
	} catch (err: any) {
		const code = err?.code === "NOT_FOUND" ? 404 : 500;
		return Response.json(
			{ message: err?.message || "Failed to get container" },
			{ status: code },
		);
	}
}
