/**
 * Direct build enqueue — POST /v1/arcd/enqueue
 *
 * The GitHub-App-free trigger for platform-native CI. The webhook path
 * (/v1/github-webhook) derives a build from `hanzo.yml` at a SHA; this route
 * lets an operator (or a repo not wired to the GitHub App) enqueue a build by
 * stating it explicitly. The downstream is identical — it reuses
 * `enqueueDirectBuild` → `createBuildJob` + the in-cluster BuildKit build muscle
 * → the build-watcher → deploy/test/publish — so there is exactly ONE build
 * path, two front doors.
 *
 * Auth: the shared machine-to-machine bearer token PLATFORM_BUILD_CALLBACK_TOKEN
 * (same credential as /v1/build-callback) — this is an infra surface, not a
 * user-facing one, so it does not use the IAM session.
 */
import { enqueueDirectBuild } from "@hanzo/platform/services/ci";
import { TRPCError } from "@trpc/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EnqueueBody {
	repo?: string;
	sha?: string;
	image?: string;
	branch?: string;
	ref?: string;
	dockerfile?: string;
	context?: string;
	/** Docker build stage (`--target`) for multi-stage Dockerfiles. */
	dockerTarget?: string;
	os?: "linux" | "darwin" | "windows";
	arch?: "amd64" | "arm64";
	organizationId?: string;
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
		return Response.json({ message: "Invalid enqueue token" }, { status: 401 });
	}

	const body = (await req.json().catch(() => ({}))) as EnqueueBody;
	if (!body?.repo || !body?.sha || !body?.image) {
		return Response.json(
			{ message: "Missing required field(s): repo, sha, image" },
			{ status: 400 },
		);
	}

	const organizationId = body.organizationId ?? process.env.DEFAULT_BUILD_ORG_ID;
	if (!organizationId) {
		return Response.json(
			{
				message:
					"organizationId is required (no DEFAULT_BUILD_ORG_ID configured on the server)",
			},
			{ status: 400 },
		);
	}

	try {
		const job = await enqueueDirectBuild({
			repo: body.repo,
			sha: body.sha,
			image: body.image,
			branch: body.branch,
			ref: body.ref,
			dockerfile: body.dockerfile,
			context: body.context,
			dockerTarget: body.dockerTarget,
			os: body.os,
			arch: body.arch,
			organizationId,
		});
		return Response.json(
			{
				buildJobId: job.buildJobId,
				status: job.status,
				runnerPool: job.runnerPool,
				image: job.image,
				target: job.target,
			},
			{ status: 202 },
		);
	} catch (err) {
		if (err instanceof TRPCError) {
			// CONFLICT (no live runner for the pool) → 409; everything else → 400.
			const code = err.code === "CONFLICT" ? 409 : 400;
			return Response.json({ message: err.message }, { status: code });
		}
		return Response.json(
			{ message: `enqueue failed: ${(err as Error).message}` },
			{ status: 500 },
		);
	}
}
