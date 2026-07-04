/**
 * GET /v1/packages — the white-label package CATALOG.
 *
 * Serves the `package` table (seeded from the canonical catalog) as
 * `{ packages: Package[] }` — the exact shape the console Tenants / White-Label
 * board's `TenantsApi.packages()` reads. Adding a package is a ROW (reseed),
 * never a code change.
 *
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN | PAAS_SERVICE_TOKEN),
 * the same M2M surface as /v1/apps and /v1/org/*. Canonical path /v1/packages
 * (served under /api/v1/packages by the /v1 rewrite). Never /api/.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { listPackages } from "@hanzo/platform/services/whitelabel";
import { methodNotAllowed, requireServiceToken } from "@/server/v1/http";

const TOKENS = ["PLATFORM_SERVICE_TOKEN", "PAAS_SERVICE_TOKEN"] as const;

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.method !== "GET") return methodNotAllowed(req, res, ["GET"]);
	if (!requireServiceToken(req, res, TOKENS)) return;

	try {
		const packages = await listPackages();
		res.setHeader("Cache-Control", "no-cache");
		res.status(200).json({ packages });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Failed to list packages";
		res.status(500).json({ message });
	}
}
