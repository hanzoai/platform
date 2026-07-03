/**
 * Build-completion callback — POST /v1/build-callback
 *
 * The platform-build workflow (running on an arcd runner) calls this once it
 * has built and pushed the image to GHCR, reporting the build-job outcome.
 * On success, platform records the result and hands the job to the
 * DeployExecutor for rollout.
 *
 * Auth: a shared bearer token (PLATFORM_BUILD_CALLBACK_TOKEN) injected into
 * the build workflow as a secret. This is a machine-to-machine surface, not a
 * user-facing one — it does not use the IAM session.
 */
import { completeBuild } from "@hanzo/platform/services/ci";
import type { NextApiRequest, NextApiResponse } from "next";
import { safeEqual } from "@/server/v1/http";

interface CallbackBody {
	buildJobId?: string;
	outcome?: string;
	installationId?: string;
	log?: string;
	error?: string;
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

	const expected = process.env.PLATFORM_BUILD_CALLBACK_TOKEN;
	if (!expected) {
		res.status(500).json({
			message: "PLATFORM_BUILD_CALLBACK_TOKEN is not configured on the server",
		});
		return;
	}
	// Constant-time bearer check (no early-exit on the token — timingSafeEqual).
	const header = req.headers.authorization ?? "";
	const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
	if (!provided || !safeEqual(provided, expected)) {
		res.status(401).json({ message: "Invalid callback token" });
		return;
	}

	const body = req.body as CallbackBody;
	if (!body?.buildJobId) {
		res.status(400).json({ message: "Missing buildJobId" });
		return;
	}
	if (body.outcome !== "success" && body.outcome !== "failure") {
		res.status(400).json({ message: "outcome must be 'success' or 'failure'" });
		return;
	}

	try {
		const result = await completeBuild({
			buildJobId: body.buildJobId,
			outcome: body.outcome,
			installationId: body.installationId,
			log: body.log,
			error: body.error,
		});
		res.status(200).json(result);
	} catch (err) {
		res.status(500).json({
			message: `Failed to complete build: ${(err as Error).message}`,
		});
	}
}
