/**
 * Platform-native CI/CD webhook — POST /v1/github-webhook
 *
 * Accepts GitHub `push` / `pull_request` (and `ping`) deliveries, validates
 * the HMAC against the configured per-installation webhook secret, and hands
 * accepted events to the BuildScheduler. This is the escape hatch from GitHub
 * Actions as a single point of failure: platform owns the build+deploy
 * lifecycle, dispatching build work to self-hosted arcd runner pools.
 *
 * Distinct from /v1/deploy/github (Dokploy app-redeploy webhook). That route
 * redeploys already-defined platform *applications*; THIS route builds and
 * rolls out *services from source* per the repo's `.platform.yml`.
 *
 * Raw-body handling: HMAC the exact bytes GitHub signed (`await req.text()`),
 * then JSON.parse the same string. App Router does not pre-parse the body, so
 * the raw bytes round-trip for signature verification.
 */
import { db } from "@hanzo/platform/db";
import { github } from "@hanzo/platform/db/schema";
import {
	decodeWebhook,
	scheduleBuilds,
	verifySignature,
	WebhookError,
} from "@hanzo/platform/services/ci";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const rawBody = await req.text();

	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(rawBody) as Record<string, unknown>;
	} catch {
		return Response.json({ message: "Body is not valid JSON" }, { status: 400 });
	}

	const installation = payload.installation as { id?: number } | undefined;
	if (!installation?.id) {
		return Response.json({ message: "Missing installation id" }, { status: 400 });
	}
	const installationId = String(installation.id);

	const provider = await db.query.github.findFirst({
		where: eq(github.githubInstallationId, installationId),
	});
	if (!provider) {
		return Response.json(
			{ message: `No GitHub provider for installation ${installationId}` },
			{ status: 404 },
		);
	}
	if (!provider.githubWebhookSecret) {
		return Response.json(
			{ message: "GitHub webhook secret not configured for provider" },
			{ status: 400 },
		);
	}

	const signature = req.headers.get("x-hub-signature-256") ?? undefined;
	if (!verifySignature(rawBody, signature, provider.githubWebhookSecret)) {
		return Response.json({ message: "Invalid signature" }, { status: 401 });
	}

	const event = req.headers.get("x-github-event") ?? undefined;

	let decoded: ReturnType<typeof decodeWebhook>;
	try {
		decoded = decodeWebhook(event, payload);
	} catch (err) {
		if (err instanceof WebhookError) {
			// 422 for "valid but nothing to do" so GitHub does not retry-storm.
			return Response.json({ message: err.message }, { status: err.status });
		}
		throw err;
	}

	if (decoded.event === "ping") {
		return Response.json({ message: "pong" });
	}

	// ACK fast: enqueue + dispatch happen synchronously here but the heavy
	// build runs on arcd. scheduleBuilds is idempotent on (repo, sha, target),
	// so a GitHub re-delivery does not double-build.
	try {
		const result = await scheduleBuilds({
			installationId,
			repo: decoded.repo,
			sha: decoded.sha,
			ref: decoded.ref,
			branch: decoded.branch,
		});
		if (!result) {
			return Response.json(
				{
					message: `Accepted; ${decoded.repo} has no .platform.yml (stays on GHA)`,
				},
				{ status: 202 },
			);
		}
		return Response.json(
			{
				message: `Accepted; scheduled ${result.jobs.length} build(s)`,
				buildJobIds: result.jobs.map((j) => j.buildJobId),
			},
			{ status: 202 },
		);
	} catch (err) {
		return Response.json(
			{ message: `Failed to schedule builds: ${(err as Error).message}` },
			{ status: 500 },
		);
	}
}
