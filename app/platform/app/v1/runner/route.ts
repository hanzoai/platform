/**
 * Direct build enqueue — POST /v1/runner
 *
 * The native runner fabric's enqueue front door (formerly /v1/arcd/enqueue).
 * "runner" is the platform's own CI/compute pool namespace — distinct from
 * github.com/arc-runner (arcd), the client-side GitHub-Actions BYO product.
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
import { buildArgsProblem, repoProblem } from "@/server/v1/build-request";
import { safeEqual } from "@/server/v1/http";

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
	/**
	 * `--build-arg` pairs. `VERSION` is derived from the image tag already, so
	 * state it here only to override that.
	 */
	buildArgs?: Record<string, string>;
	os?: "linux" | "darwin" | "windows";
	arch?: "amd64" | "arm64";
	/** The organization this caller acts as. The repository must be one of its. */
	organizationId?: string;
}

export async function POST(req: Request) {
	const expected = process.env.PLATFORM_BUILD_CALLBACK_TOKEN;
	if (!expected) {
		return Response.json(
			{
				message:
					"PLATFORM_BUILD_CALLBACK_TOKEN is not configured on the server",
			},
			{ status: 500 },
		);
	}
	// Constant-time bearer check (no early-exit on the token — timingSafeEqual).
	const header = req.headers.get("authorization") ?? "";
	const provided = header.startsWith("Bearer ")
		? header.slice("Bearer ".length)
		: "";
	if (!provided || !safeEqual(provided, expected)) {
		return Response.json({ message: "Invalid enqueue token" }, { status: 401 });
	}

	const body = (await req.json().catch(() => ({}))) as EnqueueBody;
	// `organizationId` is named here with the rest. The bearer above authenticates
	// a machine and says nothing about which organization that machine is acting
	// for, so the caller states it and the repository has to bear it out — a claim
	// nobody has to make is one nobody can get wrong.
	if (!body?.repo || !body?.sha || !body?.image || !body?.organizationId) {
		return Response.json(
			{
				message: "Missing required field(s): repo, sha, image, organizationId",
			},
			{ status: 400 },
		);
	}

	const sourceProblem = repoProblem(body.repo);
	if (sourceProblem) {
		return Response.json({ message: sourceProblem }, { status: 400 });
	}

	const argsProblem = buildArgsProblem(body.buildArgs);
	if (argsProblem) {
		return Response.json({ message: argsProblem }, { status: 400 });
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
			buildArgs: body.buildArgs,
			os: body.os,
			arch: body.arch,
			// The org that owns the build is the org that owns the repository, so
			// the caller does not choose it. Stating one is a claim to be acting
			// as it, and a claim the repository does not bear out is refused.
			requireOrganizationId: body.organizationId,
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
			// CONFLICT (no live runner for the pool) → 409, FORBIDDEN (acting as an
			// org that does not own the repository) → 403; everything else → 400.
			const code =
				err.code === "CONFLICT" ? 409 : err.code === "FORBIDDEN" ? 403 : 400;
			return Response.json({ message: err.message }, { status: code });
		}
		return Response.json(
			{ message: `enqueue failed: ${(err as Error).message}` },
			{ status: 500 },
		);
	}
}
