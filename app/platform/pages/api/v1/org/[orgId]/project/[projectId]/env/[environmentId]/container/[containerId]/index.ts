/**
 * GET /v1/org/{orgId}/project/{projectId}/env/{environmentId}/container/{containerId}
 *
 * Returns one container (Dokploy application) as the console's PaasContainer.
 *
 * Auth: shared service bearer token (PAAS_SERVICE_TOKEN).
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { findApplicationById } from "@hanzo/platform/services/application";
import {
	PAAS_NAMESPACE,
	appInScope,
	getLiveIndex,
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

	const { orgId, projectId, environmentId, containerId } = req.query as Record<
		string,
		string
	>;

	try {
		const app: any = await findApplicationById(containerId);
		if (!appInScope(app, orgId, projectId, environmentId)) {
			res.status(404).json({ message: "Container not found" });
			return;
		}
		const live = await getLiveIndex(PAAS_NAMESPACE);
		res.status(200).json(mapApplicationToContainer(app, live[app.appName]));
	} catch (err: any) {
		const code = err?.code === "NOT_FOUND" ? 404 : 500;
		res
			.status(code)
			.json({ message: err?.message || "Failed to get container" });
	}
}
