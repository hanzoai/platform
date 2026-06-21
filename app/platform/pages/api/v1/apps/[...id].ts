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
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN). Canonical path is
 * /v1/apps/{id}, served physically under /api/v1/apps/{id} via the
 * /v1/:path* → /api/v1/:path* rewrite in next.config.mjs. Never /api/.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { getApp } from "@/server/apps/apps-api";
import {
	headerValue,
	methodNotAllowed,
	queryValue,
	requireServiceToken,
} from "@/server/v1/http";

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.method !== "GET") return methodNotAllowed(req, res, ["GET"]);
	if (!requireServiceToken(req, res)) return;

	// Catch-all segments → the `<org>/<app>/<env>` id, verbatim.
	const raw = req.query.id;
	const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
	const id = segments.join("/");
	if (!id) {
		return res
			.status(400)
			.json({ message: "Missing app id (expected <org>/<app>/<env>)" });
	}

	const org = queryValue(req, "org") ?? headerValue(req, "X-Org-Id");

	try {
		const app = await getApp(id, org);
		if (!app) {
			return res.status(404).json({ message: `App not found: ${id}` });
		}
		res.setHeader("Cache-Control", "no-cache");
		res.status(200).json(app);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Failed to get app";
		res.status(500).json({ message });
	}
}
