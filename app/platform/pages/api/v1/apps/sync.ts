/**
 * POST /v1/apps/sync — reconcile the apps-lifecycle table from the live cluster
 * on demand (the same pass the in-cluster scheduler runs every interval).
 *
 * Reads the operator `Service` CRs (declared tag) + their Deployments (running
 * tag + health) and upserts the observed columns of the `apps` table. Returns
 * the per-cluster upsert counts. Read-mostly against the cluster (writes only
 * platform's own SQLite); does not patch any cluster object.
 *
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN). Canonical path is
 * /v1/apps/sync, served physically under /api/v1/apps/sync via the
 * /v1/:path* → /api/v1/:path* rewrite in next.config.mjs. Never /api/.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { syncInventory } from "@hanzo/platform/services/apps/inventory";
import { methodNotAllowed, requireServiceToken } from "@/server/v1/http";

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.method !== "POST") return methodNotAllowed(req, res, ["POST"]);
	if (!requireServiceToken(req, res)) return;

	try {
		const results = await syncInventory();
		res.status(200).json({
			results,
			total: results.reduce((n, r) => n + r.upserted, 0),
		});
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : "Failed to sync apps inventory";
		res.status(500).json({ message });
	}
}
