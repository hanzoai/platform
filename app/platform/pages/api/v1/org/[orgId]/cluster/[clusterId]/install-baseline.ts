/**
 * POST /v1/org/{orgId}/cluster/{clusterId}/install-baseline
 *
 * Install the hanzo-operator + per-tenant baseline (namespaces, PaaS-ticket
 * shared secret, ingress + gateway) onto a provisioned, running dedicated
 * cluster. The cluster's kubeconfig is derived on demand from DigitalOcean
 * (KMS DO token); nothing secret is stored.
 *
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN | PAAS_SERVICE_TOKEN).
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { findDoksClusterById } from "@hanzo/platform/services/doks-provisioner";
import { installClusterBaseline } from "@hanzo/platform/services/dedicated-cluster";
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
	if (req.method !== "POST") return methodNotAllowed(req, res, ["POST"]);
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
		const updated = await installClusterBaseline(clusterId);
		res.status(200).json({ cluster: updated });
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : "Baseline install failed";
		res.status(500).json({ message });
	}
}
