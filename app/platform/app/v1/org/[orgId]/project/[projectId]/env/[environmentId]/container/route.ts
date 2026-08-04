/**
 * GET /v1/org/{orgId}/project/{projectId}/env/{environmentId}/container
 *
 * Lists the "containers" (platform applications) in an environment, shaped as the
 * console's PaasContainer[]. Backs the console PaaS dashboard's main query.
 *
 * Auth: shared service bearer token (PAAS_SERVICE_TOKEN). See server/paas/container-api.ts.
 */
import {
	getLiveIndex,
	listApplicationsInScope,
	mapApplicationToContainer,
	PAAS_NAMESPACE,
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
		}>;
	},
) {
	const auth = requireServiceToken(req);
	if (!auth.ok) return auth.response;
	const { orgId, projectId, environmentId } = await ctx.params;

	try {
		const apps = await listApplicationsInScope(orgId, projectId, environmentId);
		const live = await getLiveIndex(PAAS_NAMESPACE);
		const containers = apps.map((app) =>
			mapApplicationToContainer(app, live[app.appName]),
		);
		return Response.json(containers);
	} catch (err: any) {
		const code = err?.code === "NOT_FOUND" ? 404 : 500;
		return Response.json(
			{ message: err?.message || "Failed to list containers" },
			{ status: code },
		);
	}
}
