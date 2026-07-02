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
 * Returns 202 + { jobName } — poll the Job (or its pod logs) for the result.
 */
import { runE2e } from "@hanzo/platform/services/ci";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RunBody {
	spec?: string;
	baseDomain?: string;
	ref?: string;
	namespace?: string;
}

export async function POST(req: Request) {
	const expected = process.env.PLATFORM_BUILD_CALLBACK_TOKEN;
	if (!expected) {
		return Response.json(
			{ message: "PLATFORM_BUILD_CALLBACK_TOKEN is not configured on the server" },
			{ status: 500 },
		);
	}
	if (req.headers.get("authorization") !== `Bearer ${expected}`) {
		return Response.json({ message: "Invalid token" }, { status: 401 });
	}

	const body = ((await req.json().catch(() => ({}))) ?? {}) as RunBody;
	try {
		const result = await runE2e({
			spec: body.spec,
			baseDomain: body.baseDomain,
			ref: body.ref,
			namespace: body.namespace,
		});
		return Response.json(result, { status: 202 });
	} catch (err) {
		return Response.json(
			{ message: `e2e launch failed: ${(err as Error).message}` },
			{ status: 500 },
		);
	}
}
