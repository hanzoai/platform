/**
 * POST /v1/apps/sync — reconcile the apps-lifecycle table on demand (the same
 * passes the in-cluster scheduler runs every interval).
 *
 * Runs the "observe" readers in order, so a single call gives the board a fully
 * refreshed verdict:
 *   1. inventory — the fleet pass: the operator workload CRs + their live
 *      workloads on every directly-readable cluster, folded with what CD
 *      reports for every OTHER cluster (lux, zoo), upserted as one row per app.
 *   2. release-meta — reads each discovered repo's latest GitHub Release and
 *      upserts `latestTag`/`releaseUrl`/`releaseAssets` (the third tag the drift
 *      checker needs). Skip it with `?releases=0` for a cluster-only refresh.
 *
 * Returns the per-cluster upsert counts and the release-meta counts. Read-mostly
 * (writes only platform's own SQLite); never patches a cluster object or GitHub.
 *
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN). Served NATIVELY at
 * /v1/apps/sync by the App Router — no rewrite. Never /api/.
 */
import { syncInventory } from "@hanzo/platform/services/apps/inventory";
import { syncReleases } from "@hanzo/platform/services/apps/release-reader";
import { queryValue, requireServiceToken } from "@/server/v1/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const auth = requireServiceToken(req);
	if (!auth.ok) return auth.response;

	try {
		const results = await syncInventory();
		const withReleases = queryValue(req, "releases") !== "0";
		const releases = withReleases ? await syncReleases() : undefined;
		return Response.json({
			results,
			total: results.reduce((n, r) => n + r.upserted, 0),
			releases,
		});
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : "Failed to sync apps inventory";
		return Response.json({ message }, { status: 500 });
	}
}
