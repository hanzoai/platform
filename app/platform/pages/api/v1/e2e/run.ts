/**
 * Platform-driven e2e trigger — POST /v1/e2e/run
 *
 * Launches the universe Playwright e2e suite as an in-cluster Job (against the
 * LIVE services) through the platform control plane. This is the test leg of
 * "platform owns build + deploy + test", with no GitHub Actions — the test
 * Job runs on our own cluster, like buildkit build Jobs.
 *
 * Auth: the shared machine-to-machine bearer token PLATFORM_BUILD_CALLBACK_TOKEN
 * (same infra credential as /v1/build-callback and /v1/arcd/enqueue).
 *
 * Body (all optional):
 *   { "spec": "tests/00-health.spec.ts", "baseDomain": "hanzo.ai",
 *     "ref": "main", "namespace": "hanzo" }
 *
 * Returns 202 + { jobName } — poll the Job (or its pod logs) for the result.
 */
import { runE2e } from "@hanzo/platform/services/ci";
import type { NextApiRequest, NextApiResponse } from "next";

interface RunBody {
	spec?: string;
	baseDomain?: string;
	ref?: string;
	namespace?: string;
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
	if (req.headers.authorization !== `Bearer ${expected}`) {
		res.status(401).json({ message: "Invalid token" });
		return;
	}

	const body = (req.body ?? {}) as RunBody;
	try {
		const result = await runE2e({
			spec: body.spec,
			baseDomain: body.baseDomain,
			ref: body.ref,
			namespace: body.namespace,
		});
		res.status(202).json(result);
	} catch (err) {
		res.status(500).json({ message: `e2e launch failed: ${(err as Error).message}` });
	}
}
