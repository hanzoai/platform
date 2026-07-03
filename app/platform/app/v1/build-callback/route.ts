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
import { safeEqual } from "@/server/v1/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CallbackBody {
	buildJobId?: string;
	outcome?: string;
	installationId?: string;
	log?: string;
	error?: string;
}

export async function POST(req: Request) {
	const expected = process.env.PLATFORM_BUILD_CALLBACK_TOKEN;
	if (!expected) {
		return Response.json(
			{ message: "PLATFORM_BUILD_CALLBACK_TOKEN is not configured on the server" },
			{ status: 500 },
		);
	}
	// Constant-time bearer check (no early-exit on the token — timingSafeEqual).
	const header = req.headers.get("authorization") ?? "";
	const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
	if (!provided || !safeEqual(provided, expected)) {
		return Response.json({ message: "Invalid callback token" }, { status: 401 });
	}

	const body = (await req.json().catch(() => ({}))) as CallbackBody;
	if (!body?.buildJobId) {
		return Response.json({ message: "Missing buildJobId" }, { status: 400 });
	}
	if (body.outcome !== "success" && body.outcome !== "failure") {
		return Response.json(
			{ message: "outcome must be 'success' or 'failure'" },
			{ status: 400 },
		);
	}

	try {
		const result = await completeBuild({
			buildJobId: body.buildJobId,
			outcome: body.outcome,
			installationId: body.installationId,
			log: body.log,
			error: body.error,
		});
		return Response.json(result);
	} catch (err) {
		return Response.json(
			{ message: `Failed to complete build: ${(err as Error).message}` },
			{ status: 500 },
		);
	}
}
