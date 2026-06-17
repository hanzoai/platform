/**
 * Platform-native CI/CD webhook — POST /v1/github-webhook
 *
 * Accepts GitHub `push` / `pull_request` (and `ping`) deliveries, validates
 * the HMAC against the configured per-installation webhook secret, and hands
 * accepted events to the BuildScheduler. This is the escape hatch from GitHub
 * Actions as a single point of failure: platform owns the build+deploy
 * lifecycle, dispatching build work to self-hosted arcd runner pools.
 *
 * Distinct from /api/deploy/github (Dokploy app-redeploy webhook). That route
 * redeploys already-defined platform *applications*; THIS route builds and
 * rolls out *services from source* per the repo's `.platform.yml`.
 *
 * Raw-body handling: Next.js' default JSON body parser is disabled here so we
 * can HMAC the exact bytes GitHub signed. Re-stringifying parsed JSON would
 * not round-trip and would break signature verification.
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
import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
	api: {
		bodyParser: false,
	},
};

async function readRawBody(req: NextApiRequest): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.method !== "POST") {
		res.setHeader("Allow", ["POST"]);
		res.status(405).json({ message: `Method ${req.method} not allowed` });
		return;
	}

	const rawBody = await readRawBody(req);

	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(rawBody) as Record<string, unknown>;
	} catch {
		res.status(400).json({ message: "Body is not valid JSON" });
		return;
	}

	const installation = payload.installation as { id?: number } | undefined;
	if (!installation?.id) {
		res.status(400).json({ message: "Missing installation id" });
		return;
	}
	const installationId = String(installation.id);

	const provider = await db.query.github.findFirst({
		where: eq(github.githubInstallationId, installationId),
	});
	if (!provider) {
		res
			.status(404)
			.json({
				message: `No GitHub provider for installation ${installationId}`,
			});
		return;
	}
	if (!provider.githubWebhookSecret) {
		res
			.status(400)
			.json({ message: "GitHub webhook secret not configured for provider" });
		return;
	}

	const signature = req.headers["x-hub-signature-256"];
	if (
		!verifySignature(
			rawBody,
			Array.isArray(signature) ? signature[0] : signature,
			provider.githubWebhookSecret,
		)
	) {
		res.status(401).json({ message: "Invalid signature" });
		return;
	}

	const eventHeader = req.headers["x-github-event"];
	const event = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;

	let decoded: ReturnType<typeof decodeWebhook>;
	try {
		decoded = decodeWebhook(event, payload);
	} catch (err) {
		if (err instanceof WebhookError) {
			// 422 for "valid but nothing to do" so GitHub does not retry-storm.
			res.status(err.status).json({ message: err.message });
			return;
		}
		throw err;
	}

	if (decoded.event === "ping") {
		res.status(200).json({ message: "pong" });
		return;
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
			res.status(202).json({
				message: `Accepted; ${decoded.repo} has no .platform.yml (stays on GHA)`,
			});
			return;
		}
		res.status(202).json({
			message: `Accepted; scheduled ${result.jobs.length} build(s)`,
			buildJobIds: result.jobs.map((j) => j.buildJobId),
		});
	} catch (err) {
		res.status(500).json({
			message: `Failed to schedule builds: ${(err as Error).message}`,
		});
	}
}
