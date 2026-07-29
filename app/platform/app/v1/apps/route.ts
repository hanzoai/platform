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
 * Auth: shared service bearer token (PLATFORM_SERVICE_TOKEN). Served NATIVELY at
 * /v1/apps by the App Router — no rewrite. Never /api/.
 */
import {
	type AppEnv,
	type AppHealth,
	type AppsQuery,
	listApps,
} from "@/server/apps/apps-api";
import { headerValue, queryValue, requireServiceToken } from "@/server/v1/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENVS = ["dev", "test", "main"] as const;
const HEALTHS = ["green", "yellow", "red"] as const;

const isEnv = (v: string | undefined): v is AppEnv =>
	v !== undefined && (ENVS as readonly string[]).includes(v);
const isHealth = (v: string | undefined): v is AppHealth =>
	v !== undefined && (HEALTHS as readonly string[]).includes(v);

export async function GET(req: Request) {
	const auth = requireServiceToken(req);
	if (!auth.ok) return auth.response;

	// Boundary-validate the enum filters; reject unknown values rather than
	// silently ignoring them.
	const env = queryValue(req, "env");
	if (env !== undefined && !isEnv(env)) {
		return Response.json(
			{ message: `Invalid env "${env}" (expected one of ${ENVS.join(", ")})` },
			{ status: 400 },
		);
	}
	const health = queryValue(req, "health");
	if (health !== undefined && !isHealth(health)) {
		return Response.json(
			{
				message: `Invalid health "${health}" (expected one of ${HEALTHS.join(", ")})`,
			},
			{ status: 400 },
		);
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
		return Response.json(result, { headers: { "Cache-Control": "no-cache" } });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Failed to list apps";
		return Response.json({ message }, { status: 500 });
	}
}
