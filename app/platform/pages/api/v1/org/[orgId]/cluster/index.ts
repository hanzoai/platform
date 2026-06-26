/**
 * /v1/org/{orgId}/cluster
 *   GET  — list the org's dedicated Hanzo K8S clusters.
 *   POST — provision a new dedicated cluster for the org (body: region?, ha?,
 *          nodeSize?, nodeCount?). The DO token is read from KMS server-side.
 *
 * The headless (service-token) mirror of the `dedicatedCluster` tRPC router, for
 * the console + automation. Auth: shared service bearer token
 * (PLATFORM_SERVICE_TOKEN | PAAS_SERVICE_TOKEN). Mirrors pages/api/v1/apps.ts.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { apiProvisionDedicatedCluster } from "@hanzo/platform/db/schema";
import {
	listOrgClusters,
	provisionDedicatedCluster,
} from "@hanzo/platform/services/dedicated-cluster";
import {
	methodNotAllowed,
	requireParams,
	requireServiceToken,
} from "@/server/v1/http";

const TOKENS = ["PLATFORM_SERVICE_TOKEN", "PAAS_SERVICE_TOKEN"] as const;

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.method !== "GET" && req.method !== "POST") {
		return methodNotAllowed(req, res, ["GET", "POST"]);
	}
	if (!requireServiceToken(req, res, TOKENS)) return;

	const params = requireParams(req, res, ["orgId"]);
	if (!params) return;
	const { orgId } = params;

	try {
		if (req.method === "GET") {
			const clusters = await listOrgClusters(orgId);
			res.setHeader("Cache-Control", "no-cache");
			return res.status(200).json({ clusters });
		}

		// POST — provision. Force the org from the path; validate the rest.
		const body = typeof req.body === "object" && req.body ? req.body : {};
		const parsed = apiProvisionDedicatedCluster.safeParse({
			...body,
			organizationId: orgId,
		});
		if (!parsed.success) {
			return res
				.status(400)
				.json({ message: "Invalid request", issues: parsed.error.issues });
		}
		const cluster = await provisionDedicatedCluster(parsed.data);
		return res.status(201).json({ cluster });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Cluster request failed";
		res.status(500).json({ message });
	}
}
