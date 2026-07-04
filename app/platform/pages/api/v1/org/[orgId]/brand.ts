/**
 * /v1/org/{orgId}/brand
 *   GET — read the org's per-org brand config.
 *   PUT — write it (the board's `TenantsApi.writeBrand()`). Applies the brand to
 *         `org_brand`, so `GET /v1/brand?host=` reflects it immediately.
 *
 * The per-org brand store is the reseller replacement for the Dokploy global
 * `webServerSettings` singleton. When the body carries a `host`, the host is
 * (re)bound to this org so the brand resolves for that host.
 *
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN | PAAS_SERVICE_TOKEN).
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { apiWriteBrand } from "@hanzo/platform/db/schema";
import {
	bindDomain,
	getOrgBrand,
	writeOrgBrand,
} from "@hanzo/platform/services/whitelabel";
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
	if (req.method !== "GET" && req.method !== "PUT") {
		return methodNotAllowed(req, res, ["GET", "PUT"]);
	}
	if (!requireServiceToken(req, res, TOKENS)) return;

	const params = requireParams(req, res, ["orgId"]);
	if (!params) return;
	const { orgId } = params;

	try {
		if (req.method === "GET") {
			const brand = await getOrgBrand(orgId);
			res.setHeader("Cache-Control", "no-cache");
			return res.status(200).json({ brand: brand ?? null });
		}

		const body = typeof req.body === "object" && req.body ? req.body : {};
		const parsed = apiWriteBrand.safeParse(body);
		if (!parsed.success) {
			return res
				.status(400)
				.json({ message: "Invalid request", issues: parsed.error.issues });
		}
		const brand = await writeOrgBrand(orgId, parsed.data);
		// If a host was supplied, (re)bind it to this org so the brand resolves.
		if (parsed.data.host) {
			await bindDomain(orgId, { host: parsed.data.host, serviceName: "console" });
		}
		return res.status(200).json({ ok: true, brand });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Brand request failed";
		res.status(500).json({ message });
	}
}
