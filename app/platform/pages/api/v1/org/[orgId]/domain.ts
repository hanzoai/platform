/**
 * /v1/org/{orgId}/domain
 *   GET  — list the org's bound white-label hosts.
 *   POST — bind a host to the org → auto-create the ingress (route host → the
 *          console/service) + DNS record + cert, then store the binding.
 *
 * The board's `TenantsApi.domains()` / `bindDomain()` back these. A bind
 * REPLACES the hand-made ingresses — it auto-provisions ingress+DNS+cert. The
 * routed-host set DERIVES from these rows (no hardcoded host list).
 *
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN | PAAS_SERVICE_TOKEN).
 * Mirrors pages/api/v1/org/[orgId]/cluster/index.ts.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import {
	apiBindDomain,
	type WhitelabelDomain,
} from "@hanzo/platform/db/schema";
import { bindDomain, listDomains } from "@hanzo/platform/services/whitelabel";
import {
	methodNotAllowed,
	requireParams,
	requireServiceToken,
} from "@/server/v1/http";

const TOKENS = ["PLATFORM_SERVICE_TOKEN", "PAAS_SERVICE_TOKEN"] as const;

/** Project a stored binding to the console's `TenantDomain` view. */
function toView(d: WhitelabelDomain) {
	return {
		host: d.host,
		serviceName: d.serviceName,
		https: d.https,
		status: d.status,
		error: d.error ?? undefined,
	};
}

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.method !== "GET" && req.method !== "POST") {
		return methodNotAllowed(req, res, ["GET", "POST"]);
	}
	if (!requireServiceToken(req, res, TOKENS)) return;

	const params = requireParams(req, res, ["orgId"]);
	if (!params) return;
	const { orgId } = params;

	try {
		if (req.method === "GET") {
			const domains = (await listDomains(orgId)).map(toView);
			res.setHeader("Cache-Control", "no-cache");
			return res.status(200).json({ domains });
		}

		const body = typeof req.body === "object" && req.body ? req.body : {};
		const parsed = apiBindDomain.safeParse(body);
		if (!parsed.success) {
			return res
				.status(400)
				.json({ message: "Invalid request", issues: parsed.error.issues });
		}
		const binding = await bindDomain(orgId, {
			host: parsed.data.host,
			serviceName: parsed.data.serviceName,
			port: parsed.data.port,
			https: parsed.data.https,
			namespace: parsed.data.namespace,
			cluster: parsed.data.cluster,
		});
		return res.status(201).json({ domain: toView(binding) });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Domain request failed";
		res.status(500).json({ message });
	}
}
