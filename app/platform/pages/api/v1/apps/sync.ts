/**
 * POST /v1/apps/sync — reconcile the apps-lifecycle table on demand (the same
 * passes the in-cluster scheduler runs every interval).
 *
 * Runs BOTH "observe" readers in order, so a single call gives the board a fully
 * refreshed verdict:
 *   1. inventory — reads the operator `Service` CRs (declared tag) + their
 *      Deployments (running tag + health) and upserts those observed columns.
 *   2. release-meta — reads each discovered repo's latest GitHub Release and
 *      upserts `latestTag`/`releaseUrl`/`releaseAssets` (the third tag the drift
 *      checker needs). Skip it with `?releases=0` for a cluster-only refresh.
 *
 * Returns the per-cluster upsert counts and the release-meta counts. Read-mostly
 * (writes only platform's own SQLite); never patches a cluster object or GitHub.
 *
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN). Canonical path is
 * /v1/apps/sync, served physically under /api/v1/apps/sync via the
 * /v1/:path* → /api/v1/:path* rewrite in next.config.mjs. Never /api/.
 */

import { syncInventory } from "@hanzo/platform/services/apps/inventory";
import { syncReleases } from "@hanzo/platform/services/apps/release-reader";
import type { NextApiRequest, NextApiResponse } from "next";
import { methodNotAllowed, requireServiceToken } from "@/server/v1/http";

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.method !== "POST") return methodNotAllowed(req, res, ["POST"]);
	if (!requireServiceToken(req, res)) return;

	try {
		const results = await syncInventory();
		const withReleases = req.query.releases !== "0";
		const releases = withReleases ? await syncReleases() : undefined;
		res.status(200).json({
			results,
			total: results.reduce((n, r) => n + r.upserted, 0),
			releases,
		});
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : "Failed to sync apps inventory";
		res.status(500).json({ message });
	}
}
