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
 * Auth: `validateRequest`, the same identity every other /v1 surface reads —
 * an IAM access token as `Authorization: Bearer`, or an organization-scoped
 * `x-api-key`. Both CARRY an organization; that is why they are what this door
 * takes. A build publishes into a namespace on a credential the cluster mounts,
 * so the organization it acts as has to come from the caller's identity rather
 * than from the caller's request — a machine credential that authenticates a
 * deployment says which deployment, and every organization in it looks alike
 * from there.
 */
import { validateRequest } from "@hanzo/platform/lib/auth";
import { enqueueDirectBuild } from "@hanzo/platform/services/ci";
import { TRPCError } from "@trpc/server";
import { buildArgsProblem, repoProblem } from "@/server/v1/build-request";
import { asIncomingMessage } from "@/server/v1/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EnqueueBody {
	repo?: string;
	/**
	 * The branch or tag to build, whole — `refs/heads/main`, `refs/tags/v1.2.3`.
	 *
	 * The commit follows from it on the forge, so there is no `sha` field: a
	 * caller states the name it wants built and the forge says what that is.
	 */
	ref?: string;
	image?: string;
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
}

export async function POST(req: Request) {
	// Who is asking, and which organization they are. Read off the credential,
	// which is the only place an answer to the second question can come from
	// that the caller did not choose.
	const { session, user } = await validateRequest(asIncomingMessage(req));
	const organizationId = session?.activeOrganizationId;
	if (!user || !organizationId) {
		return Response.json({ message: "Unauthorized" }, { status: 401 });
	}

	const body = (await req.json().catch(() => ({}))) as EnqueueBody;
	if (!body?.repo || !body?.ref || !body?.image) {
		return Response.json(
			{ message: "Missing required field(s): repo, ref, image" },
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
			ref: body.ref,
			image: body.image,
			dockerfile: body.dockerfile,
			context: body.context,
			dockerTarget: body.dockerTarget,
			buildArgs: body.buildArgs,
			os: body.os,
			arch: body.arch,
			// The org that owns the build is the org that owns the repository. The
			// caller's own organization is what it is checked against, so a caller
			// reaching a repository outside it is refused — and there is no field
			// here to state a different one with.
			requireOrganizationId: organizationId,
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
			// CONFLICT (no live runner for the pool) → 409, FORBIDDEN (a repository
			// outside the caller's organization) → 403, NOT_FOUND (a ref the forge
			// does not resolve) → 404; everything else → 400.
			const code =
				err.code === "CONFLICT"
					? 409
					: err.code === "FORBIDDEN"
						? 403
						: err.code === "NOT_FOUND"
							? 404
							: 400;
			return Response.json({ message: err.message }, { status: code });
		}
		return Response.json(
			{ message: `enqueue failed: ${(err as Error).message}` },
			{ status: 500 },
		);
	}
}
