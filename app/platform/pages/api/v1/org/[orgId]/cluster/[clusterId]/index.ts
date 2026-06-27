/**
 * /v1/org/{orgId}/cluster/{clusterId}
 *   GET    — one cluster owned by the org (sealed kubeconfig redacted).
 *   DELETE — destroy the cluster. A managed DOKS cluster is torn down on
 *            DigitalOcean (associated resources included); an attached BYO
 *            cluster is detached (the record is marked deleted — platform never
 *            owned the external infra, so nothing is destroyed remotely).
 *
 * Every op is scoped to the org in the path: the cluster must belong to it or
 * the response is 404 (never reveal another tenant's cluster). The headless
 * (service-token) mirror of the cluster lifecycle for the console + automation.
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN | PAAS_SERVICE_TOKEN).
 */

import { redactCluster } from "@hanzo/platform/services/dedicated-cluster";
import {
	deleteDoksCluster,
	findDoksClusterById,
} from "@hanzo/platform/services/doks-provisioner";
import type { NextApiRequest, NextApiResponse } from "next";
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
	if (req.method !== "GET" && req.method !== "DELETE") {
		return methodNotAllowed(req, res, ["GET", "DELETE"]);
	}
	if (!requireServiceToken(req, res, TOKENS)) return;

	const params = requireParams(req, res, ["orgId", "clusterId"]);
	if (!params) return;
	const { orgId, clusterId } = params;

	try {
		// Scope guard: the cluster must belong to the org in the path.
		const cluster = await findDoksClusterById(clusterId);
		if (cluster.organizationId !== orgId) {
			return res.status(404).json({ message: "Cluster not found" });
		}

		if (req.method === "DELETE") {
			await deleteDoksCluster(clusterId);
			return res.status(200).json({ deleted: true, doksClusterId: clusterId });
		}

		res.setHeader("Cache-Control", "no-cache");
		return res.status(200).json({ cluster: redactCluster(cluster) });
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : "Cluster request failed";
		res.status(500).json({ message });
	}
}
