import { findApps } from "@hanzo/platform";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { NextApiRequest, NextApiResponse } from "next";
import { apiListApps } from "@/server/db/schema";

/**
 * GET /v1/apps — the canonical REST entry for the apps-lifecycle drift view.
 *
 * Contract: `docs/APPS_LIFECYCLE.md` §6 ("Reads /v1/apps"). Thin transport:
 * authenticate, parse the org/env/health filter, delegate to the single
 * `findApps` data path that the in-app page also uses. Same query, same drift
 * derivation — the page and the API can never report different drift.
 *
 * Auth mirrors `pages/api/[...trpc].ts`: session cookie or API key via
 * `validateRequest`; rows are scoped to the resolved active organization.
 */
export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.method !== "GET") {
		res.setHeader("Allow", "GET");
		return res.status(405).json({ message: "Method Not Allowed" });
	}

	const { session, user } = await validateRequest(req);
	if (!user || !session) {
		return res.status(401).json({ message: "Unauthorized" });
	}

	const parsed = apiListApps.safeParse({
		org: req.query.org,
		env: req.query.env,
		health: req.query.health,
	});
	if (!parsed.success) {
		return res
			.status(400)
			.json({ message: "Invalid query", issues: parsed.error.issues });
	}

	const apps = await findApps(session.activeOrganizationId, parsed.data);
	return res.status(200).json(apps);
}
