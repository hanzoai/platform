/**
 * GET /v1/apps/{id} — one apps-lifecycle row by its `<org>/<app>/<env>` id
 * (PR 3 of APPS_LIFECYCLE.md), e.g. GET /v1/apps/hanzoai/iam/main.
 *
 * The id contains slashes (`<org>/<app>/<env>`), so this is a catch-all route
 * (`[...id]`) and the segments are re-joined into the canonical id. Returns the
 * observed row plus its computed drift verdict; 404 when the id is unknown (or
 * out of the requested org scope).
 *
 * Org scope: optional `X-Org-Id` header / `?org=` — when set, the row must
 * belong to that org or it 404s (a tenant can't read another tenant's row by
 * guessing the id).
 *
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN). Served NATIVELY at
 * /v1/apps/{id} by the App Router — no rewrite. Never /api/.
 */
import { getApp } from "@/server/apps/apps-api";
import { headerValue, queryValue, requireServiceToken } from "@/server/v1/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
	req: Request,
	ctx: { params: Promise<{ id: string[] }> },
) {
	const auth = requireServiceToken(req);
	if (!auth.ok) return auth.response;

	// Catch-all segments → the `<org>/<app>/<env>` id, verbatim.
	const { id: raw } = await ctx.params;
	const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
	const id = segments.join("/");
	if (!id) {
		return Response.json(
			{ message: "Missing app id (expected <org>/<app>/<env>)" },
			{ status: 400 },
		);
	}

	const org = queryValue(req, "org") ?? headerValue(req, "X-Org-Id");

	try {
		const app = await getApp(id, org);
		if (!app) {
			return Response.json(
				{ message: `App not found: ${id}` },
				{ status: 404 },
			);
		}
		return Response.json(app, { headers: { "Cache-Control": "no-cache" } });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Failed to get app";
		return Response.json({ message }, { status: 500 });
	}
}
