/**
 * GET /v1/apps — the apps-lifecycle drift board (PR 3 of APPS_LIFECYCLE.md).
 *
 * Returns every (org, app, env) row from the `apps` table with its observed
 * tags and the computed drift verdict, so the console page at
 * `platform.hanzo.ai/apps` and any external caller can see declared / running /
 * latest / drift "without ssh / kubectl" (the contract's keystone).
 *
 * Query filters (all optional): `org`, `env` (dev|test|main), `health`
 * (green|yellow|red), `drift` (true → only drifting rows). Org scope also reads
 * the `X-Org-Id` header (contract's X-Org-Id convention); an explicit `?org=`
 * wins over the header.
 *
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN). Canonical path is
 * /v1/apps — the pages router physically serves this under /api/v1/apps via the
 * /v1/:path* → /api/v1/:path* rewrite in next.config.mjs. Never /api/.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import {
	type AppEnv,
	type AppHealth,
	type AppsQuery,
	listApps,
} from "@/server/apps/apps-api";
import {
	headerValue,
	methodNotAllowed,
	queryValue,
	requireServiceToken,
} from "@/server/v1/http";

const ENVS = ["dev", "test", "main"] as const;
const HEALTHS = ["green", "yellow", "red"] as const;

const isEnv = (v: string | undefined): v is AppEnv =>
	v !== undefined && (ENVS as readonly string[]).includes(v);
const isHealth = (v: string | undefined): v is AppHealth =>
	v !== undefined && (HEALTHS as readonly string[]).includes(v);

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.method !== "GET") return methodNotAllowed(req, res, ["GET"]);
	if (!requireServiceToken(req, res)) return;

	// Boundary-validate the enum filters; reject unknown values rather than
	// silently ignoring them.
	const env = queryValue(req, "env");
	if (env !== undefined && !isEnv(env)) {
		return res
			.status(400)
			.json({ message: `Invalid env "${env}" (expected one of ${ENVS.join(", ")})` });
	}
	const health = queryValue(req, "health");
	if (health !== undefined && !isHealth(health)) {
		return res.status(400).json({
			message: `Invalid health "${health}" (expected one of ${HEALTHS.join(", ")})`,
		});
	}

	const query: AppsQuery = {
		org: queryValue(req, "org") ?? headerValue(req, "X-Org-Id"),
		env: isEnv(env) ? env : undefined,
		health: isHealth(health) ? health : undefined,
		drift: queryValue(req, "drift") === "true",
	};

	try {
		const result = await listApps(query);
		// Observed data turns over on the readers' cron cadence; let intermediaries
		// cache briefly but always revalidate.
		res.setHeader("Cache-Control", "no-cache");
		res.status(200).json(result);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Failed to list apps";
		res.status(500).json({ message });
	}
}
