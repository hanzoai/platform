/**
 * /v1/org/{orgId}/cluster/select
 *   GET  — the org's current resolved deploy target (kubeconfig redacted).
 *   POST — select the active deploy target (body: { doksClusterId } to point at
 *          a dedicated cluster, or { doksClusterId: null } to revert to shared).
 *
 * This is the "re-point the operator target" control: after selecting a
 * dedicated cluster, `resolveOrgClusterTarget` (used by operator-apply +
 * inventory) returns it, so subsequent deploys land on the dedicated cluster.
 *
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN | PAAS_SERVICE_TOKEN).
 */
import type { NextApiRequest, NextApiResponse } from "next";
import {
	redactTarget,
	resolveOrgClusterTarget,
	selectDeployTarget,
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
		if (req.method === "POST") {
			const body = typeof req.body === "object" && req.body ? req.body : {};
			const raw = (body as { doksClusterId?: unknown }).doksClusterId;
			if (raw !== null && typeof raw !== "string") {
				return res.status(400).json({
					message: "doksClusterId must be a string, or null to revert to shared",
				});
			}
			await selectDeployTarget(orgId, raw ?? null);
		}
		const target = redactTarget(await resolveOrgClusterTarget(orgId));
		res.setHeader("Cache-Control", "no-cache");
		res.status(200).json({ target });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Select target failed";
		res.status(500).json({ message });
	}
}
