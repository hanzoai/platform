/**
 * POST /v1/apps/apply — push the declared `Service` CRs from git into the
 * cluster on demand (the same git→CR apply the in-cluster scheduler runs every
 * tick). The platform-native replacement for the `gitops-reconcile` kubectl
 * cron: the cloud CLI's `hanzo apps apply` calls it for an instant reconcile
 * after a universe merge, and a universe-push webhook can POST here for zero-wait
 * apply — that webhook is the only remaining seam; no separate subsystem is
 * needed because this endpoint IS the apply entrypoint.
 *
 * Applies ONLY the reconcilable set: a CR bearing `hanzo.ai/reconcile: platform`
 * OR whose name is in the seed allowlist. Idempotent (create-or-update), never
 * prunes, best-effort per-CR (one failure never aborts the rest). Returns the
 * apply summary (`applied`/`skipped`/`failed`/`unchanged`).
 *
 * Orthogonal to POST /v1/apps/sync (observe-only): apply writes CRs, sync reads
 * the cluster into the board. The scheduler composes the two; the endpoints
 * mirror that separation.
 *
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN). Served NATIVELY at
 * /v1/apps/apply by the App Router — no rewrite. Never /api/.
 */
import { applyDeclaredCRs } from "@hanzo/platform/services/apps/apply-declared";
import { requireServiceToken } from "@/server/v1/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const auth = requireServiceToken(req);
	if (!auth.ok) return auth.response;

	try {
		const summary = await applyDeclaredCRs();
		return Response.json(summary);
	} catch (err: unknown) {
		const message =
			err instanceof Error ? err.message : "Failed to apply declared CRs";
		return Response.json({ message }, { status: 500 });
	}
}
