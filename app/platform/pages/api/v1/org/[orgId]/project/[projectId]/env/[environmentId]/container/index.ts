/**
 * GET /v1/org/{orgId}/project/{projectId}/env/{environmentId}/container
 *
 * Lists the "containers" (Dokploy applications) in an environment, shaped as the
 * console's PaasContainer[]. Backs the console PaaS dashboard's main query.
 *
 * Auth: shared service bearer token (PAAS_SERVICE_TOKEN). See server/paas/container-api.ts.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import {
	PAAS_NAMESPACE,
	getLiveIndex,
	listApplicationsInScope,
	mapApplicationToContainer,
	methodNotAllowed,
	requireServiceToken,
} from "@/server/paas/container-api";

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.method !== "GET") return methodNotAllowed(req, res, ["GET"]);
	if (!requireServiceToken(req, res)) return;

	const { orgId, projectId, environmentId } = req.query as Record<
		string,
		string
	>;

	try {
		const apps = await listApplicationsInScope(orgId, projectId, environmentId);
		const live = await getLiveIndex(PAAS_NAMESPACE);
		const containers = apps.map((app) =>
			mapApplicationToContainer(app, live[app.appName]),
		);
		res.status(200).json(containers);
	} catch (err: any) {
		const code = err?.code === "NOT_FOUND" ? 404 : 500;
		res
			.status(code)
			.json({ message: err?.message || "Failed to list containers" });
	}
}
