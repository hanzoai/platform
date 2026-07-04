/**
 * GET /v1/brand?host=<h> — resolve a request host to its tenant brand config,
 * purely FROM DATA (whitelabel_domain + organization + org_brand). This is the
 * read that KILLS the console's hardcoded `BRANDS`/`HOST_BRANDS` map.
 *
 * Returns the `TenantBrandConfig` the console's `TenantsApi.brandConfig`
 * normalizer reads: `{ org, brandName, logoUrl, faviconUrl, iamUrl, iamApp,
 * iamOrgName, accentColor }`. A host bound to no org → `null` (204), so the
 * console falls back to its build-time default — never a wrong brand.
 *
 * Auth: shared service bearer token (the console's /paas proxy sends it).
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { resolveBrandByHost } from "@hanzo/platform/services/whitelabel";
import {
	methodNotAllowed,
	queryValue,
	requireServiceToken,
} from "@/server/v1/http";

const TOKENS = ["PLATFORM_SERVICE_TOKEN", "PAAS_SERVICE_TOKEN"] as const;

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.method !== "GET") return methodNotAllowed(req, res, ["GET"]);
	if (!requireServiceToken(req, res, TOKENS)) return;

	const host = queryValue(req, "host");
	if (!host) {
		return res.status(400).json({ message: "Missing required query: host" });
	}

	try {
		const brand = await resolveBrandByHost(host);
		res.setHeader("Cache-Control", "no-cache");
		// The console normalizer treats a body with no `org` as "no record". Return
		// an empty object (200) for an unbound host so the client falls back to its
		// build-time default rather than surfacing an error.
		res.status(200).json(brand ?? {});
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Failed to resolve brand";
		res.status(500).json({ message });
	}
}
