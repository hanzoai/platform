/**
 * POST /v1/org/{orgId}/cluster/attach
 *
 * Attach an external (bring-your-own) Kubernetes cluster as a deploy target for
 * the org. Body: { name, kubeconfig }. The kubeconfig is validated, then sealed
 * (AES-256-GCM, services/secret-box) before it touches the DB — the ciphertext
 * is never returned. The attached cluster lands `phase=requested`; call
 * /v1/org/{orgId}/cluster/{clusterId}/install-baseline to make it deployable.
 *
 * The headless (service-token) mirror of the `dedicatedCluster.attachExternal`
 * tRPC procedure, for the console + automation. Auth: shared service bearer
 * token (PLATFORM_SERVICE_TOKEN | PAAS_SERVICE_TOKEN).
 */

import { apiAttachExternalCluster } from "@hanzo/platform/db/schema";
import { attachExternalCluster } from "@hanzo/platform/services/dedicated-cluster";
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
	if (req.method !== "POST") return methodNotAllowed(req, res, ["POST"]);
	if (!requireServiceToken(req, res, TOKENS)) return;

	const params = requireParams(req, res, ["orgId"]);
	if (!params) return;
	const { orgId } = params;

	try {
		// Force the org from the path; validate name + kubeconfig from the body.
		const body = typeof req.body === "object" && req.body ? req.body : {};
		const parsed = apiAttachExternalCluster.safeParse({
			...body,
			organizationId: orgId,
		});
		if (!parsed.success) {
			return res
				.status(400)
				.json({ message: "Invalid request", issues: parsed.error.issues });
		}
		const cluster = await attachExternalCluster(parsed.data);
		return res.status(201).json({ cluster });
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : "Attach cluster failed";
		res.status(500).json({ message });
	}
}
