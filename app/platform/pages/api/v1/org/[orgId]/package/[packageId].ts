/**
 * /v1/org/{orgId}/package/{packageId}
 *   POST   — provisionPackage: the atomic "enable a package" action. Deploys the
 *            package's services, binds its domain (ingress+DNS+cert), scopes its
 *            IAM tenant, applies its brand, sets its billing plan, and records
 *            the grant with the HONEST per-service state.
 *   DELETE — deprovision: tear down the CRs + domain, remove the grant.
 *
 * The board's `TenantsApi.provisionPackage()` / `deprovisionPackage()` back
 * these. Idempotent on (org, package). Never fakes a "provisioned" state — a
 * service with no deploy template is recorded `pending`.
 *
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN | PAAS_SERVICE_TOKEN).
 */
import type { NextApiRequest, NextApiResponse } from "next";
import {
	deprovisionPackage,
	provisionPackage,
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
	if (req.method !== "POST" && req.method !== "DELETE") {
		return methodNotAllowed(req, res, ["POST", "DELETE"]);
	}
	if (!requireServiceToken(req, res, TOKENS)) return;

	const params = requireParams(req, res, ["orgId", "packageId"]);
	if (!params) return;
	const { orgId, packageId } = params;

	try {
		if (req.method === "DELETE") {
			await deprovisionPackage(orgId, packageId);
			return res.status(200).json({ ok: true });
		}

		// POST — provision. Optional `slug` override in the body.
		const body = typeof req.body === "object" && req.body ? req.body : {};
		const slug =
			typeof body.slug === "string" && body.slug ? body.slug : undefined;
		const { grant, pkg } = await provisionPackage(orgId, packageId, slug);
		return res.status(201).json({
			ok: true,
			status: grant.status,
			grant,
			package: { id: pkg.id, name: pkg.name },
		});
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Package request failed";
		// A genuinely unknown org/package is a 400; anything else is a 500.
		const code = /^Unknown (package|organization)/.test(message) ? 400 : 500;
		res.status(code).json({ message });
	}
}
