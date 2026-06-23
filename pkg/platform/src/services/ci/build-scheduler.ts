/**
 * BuildScheduler — platform-native CI/CD orchestrator.
 *
 * Flow (one call per accepted webhook):
 *   1. Authenticate the delivery against the provider's installation id.
 *   2. Fetch `.platform.yml` from the repo at the triggering SHA.
 *   3. Validate it; enqueue one `buildJob` row per matrix entry, keyed
 *      uniquely by (repo, sha, target).
 *   4. Dispatch each job to its arcd runner pool.
 *
 * arcd dispatch — native long-poll (default) with workflow_dispatch fallback:
 *   Platform owns a native long-poll protocol. When a build's pool has a live
 *   registered arcd runner (an `arcd_runner` row with a recent `lastSeen`), the
 *   scheduler enqueues the job onto the in-process long-poll fabric
 *   (`buildQueue`); the runner pulls it via POST /v1/arcd/poll, builds, pushes
 *   to GHCR, and reports back via POST /v1/arcd/complete. No GitHub Actions hop.
 *
 *   The legacy `workflow_dispatch` path remains for migration: it is used when
 *   the repo's `.platform.yml` sets `build.dispatch: workflow_dispatch`, when
 *   the WORKFLOW_DISPATCH_FALLBACK env forces it, or transparently when a
 *   `native` pool has NO live runner yet (so a build is never stranded). As
 *   runners self-register over the new protocol, pools flip to native with no
 *   config change. Platform owns the system-of-record (this module + the
 *   buildJob table) and the deploy decision regardless of dispatch path.
 */
import { authGithub } from "@hanzo/platform/utils/providers/github";
import { TRPCError } from "@trpc/server";
import { findGithubByInstallationId } from "../github";
import { poolHasLiveRunner } from "./arcd-runner";
import type { BuildJob } from "./build-job";
import {
	createBuildJob,
	findBuildJobByTarget,
	markBuildRunning,
} from "./build-job";
import { buildQueue } from "./build-queue";
import {
	type BuildArch,
	type BuildConfig,
	type BuildOS,
	type DispatchMode,
	type PlatformConfig,
	parsePlatformConfig,
	resolveTag,
	runnerPoolFor,
} from "./platform-config";

/** Canonical reusable workflow filename platform dispatches build jobs to. */
const PLATFORM_BUILD_WORKFLOW = "platform-build.yml";

export interface ScheduleInput {
	/** GitHub App installation id from the webhook payload. */
	installationId: string;
	repo: string;
	sha: string;
	ref: string;
	branch: string;
}

export interface ScheduleResult {
	organizationId: string;
	config: PlatformConfig;
	jobs: BuildJob[];
}

interface ResolvedProvider {
	provider: Parameters<typeof authGithub>[0];
	organizationId: string;
}

async function resolveProvider(
	installationId: string,
): Promise<ResolvedProvider> {
	const row = await findGithubByInstallationId(installationId);
	if (!row) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `No GitHub provider configured for installation ${installationId}`,
		});
	}
	const organizationId = row.gitProvider?.organizationId;
	if (!organizationId) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: `GitHub provider ${row.githubId} is not linked to an organization`,
		});
	}
	return { provider: row as ResolvedProvider["provider"], organizationId };
}

/**
 * Canonical repo config name is `hanzo.yml`. `.platform.yml` is the legacy
 * name, read only as a transitional fallback until every repo has migrated —
 * remove it once base/insights/app are all on `hanzo.yml`.
 */
const CONFIG_NAMES = ["hanzo.yml", ".platform.yml"] as const;

/**
 * Fetch the repo's platform config at a specific ref, trying each name in
 * `CONFIG_NAMES` order. Returns the parsed + validated config, or null when
 * the repo has not opted in (no config file under any name). Any other failure
 * (bad YAML, schema violation, API error) throws.
 */
export async function fetchPlatformConfig(
	provider: ResolvedProvider["provider"],
	repo: string,
	ref: string,
): Promise<PlatformConfig | null> {
	const [owner, name] = repo.split("/");
	if (!owner || !name) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Invalid repo "${repo}"; expected owner/name`,
		});
	}
	const octokit = authGithub(provider);
	for (const path of CONFIG_NAMES) {
		try {
			const res = await octokit.rest.repos.getContent({
				owner,
				repo: name,
				path,
				ref,
			});
			const data = res.data as { content?: string; encoding?: string };
			if (!data.content || data.encoding !== "base64") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `${path} in ${repo}@${ref} is not a regular file`,
				});
			}
			const text = Buffer.from(data.content, "base64").toString("utf8");
			return parsePlatformConfig(text);
		} catch (err) {
			const e = err as { status?: number };
			if (e.status === 404) continue; // not under this name — try the next
			if (err instanceof TRPCError) throw err;
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Failed to read ${path} from ${repo}@${ref}: ${(err as Error).message}`,
			});
		}
	}
	return null; // no config under any candidate name → repo not opted in
}

/**
 * Decide how a job reaches its runner. `workflow_dispatch` wins when the repo
 * pins it, when WORKFLOW_DISPATCH_FALLBACK forces it globally, or when a
 * `native` pool has no live runner yet (transparent fallback so a build is
 * never stranded). Otherwise `native`.
 */
export async function resolveDispatchMode(
	build: BuildConfig,
	pool: string,
	now: number = Date.now(),
): Promise<DispatchMode> {
	if (build.dispatch === "workflow_dispatch") return "workflow_dispatch";
	if (process.env.WORKFLOW_DISPATCH_FALLBACK === "true") {
		return "workflow_dispatch";
	}
	return (await poolHasLiveRunner(pool, now)) ? "native" : "workflow_dispatch";
}

/**
 * Dispatch a single build job natively: enqueue it onto the long-poll fabric
 * for its pool. An arcd runner pulls it via POST /v1/arcd/poll. Returns the
 * dispatch correlation id (`native:<buildJobId>`).
 */
function dispatchNative(
	job: BuildJob,
	build: BuildConfig,
	installationId: string,
): string {
	buildQueue.enqueue(job.runnerPool, {
		buildJobId: job.buildJobId,
		repo: job.repo,
		sha: job.sha,
		ref: job.ref,
		branch: job.branch,
		target: job.target,
		image: job.image,
		dockerfile: build.dockerfile,
		context: build.context,
		push: build.push,
		installationId,
	});
	return `native:${job.buildJobId}`;
}

/**
 * Spec for a GitHub-App-free direct build. The webhook path derives all of
 * this from `.platform.yml` at a SHA; this lets an operator (or a repo not
 * wired to the GitHub App) enqueue a build by stating it explicitly. The
 * downstream is identical — `createBuildJob` + the native long-poll fabric —
 * so there is exactly ONE queue and ONE runner protocol, two front doors.
 */
export interface DirectBuildInput {
	/** owner/name — used only to derive the arcd pool's org segment. */
	repo: string;
	sha: string;
	ref?: string;
	branch?: string;
	/** Fully-resolved image ref to build + push, e.g. ghcr.io/hanzoai/x:tag. */
	image: string;
	dockerfile?: string;
	context?: string;
	push?: boolean;
	/** Build target os/arch (default linux/amd64). Drives the pool + platform. */
	os?: BuildOS;
	arch?: BuildArch;
	organizationId: string;
}

/**
 * Enqueue a single build directly onto the native long-poll fabric, WITHOUT a
 * GitHub App or `.platform.yml`. This is the GitHub-free trigger: it REQUIRES a
 * live registered arcd runner for the target pool (no workflow_dispatch
 * fallback — that would re-introduce GitHub), and fails loud if none is live so
 * a build is never silently stranded. Returns the created build job.
 *
 * Idempotent on (repo, sha, target): re-enqueuing the same target returns the
 * existing job instead of duplicating, matching scheduleBuilds.
 */
export async function enqueueDirectBuild(
	input: DirectBuildInput,
): Promise<BuildJob> {
	const os: BuildOS = input.os ?? "linux";
	const arch: BuildArch = input.arch ?? "amd64";
	const target = `${os}/${arch}`;
	const branch = input.branch ?? "main";
	const ref = input.ref ?? `refs/heads/${branch}`;

	const existing = await findBuildJobByTarget(input.repo, input.sha, target);
	if (existing) return existing;

	const pool = runnerPoolFor(orgLabel(input.repo), { os, arch });
	if (!(await poolHasLiveRunner(pool))) {
		throw new TRPCError({
			code: "CONFLICT",
			message: `No live arcd runner for pool ${pool}; cannot dispatch natively (GitHub-free path does not fall back to workflow_dispatch). Start an arcbuild worker for this pool.`,
		});
	}

	const job = await createBuildJob({
		repo: input.repo,
		sha: input.sha,
		ref,
		branch,
		target,
		runnerPool: pool,
		image: input.image,
		organizationId: input.organizationId,
		status: "queued",
		rolloutStatus: "skipped",
	});

	buildQueue.enqueue(pool, {
		buildJobId: job.buildJobId,
		repo: job.repo,
		sha: job.sha,
		ref: job.ref,
		branch: job.branch,
		target: job.target,
		image: job.image,
		dockerfile: input.dockerfile ?? "./Dockerfile",
		context: input.context ?? ".",
		push: input.push ?? true,
		// Direct builds have no GitHub installation; the completion path keys
		// deploy config off `.platform.yml` only when this is set, so "" means
		// "build-only, no operator rollout" — exactly right for a manual build.
		installationId: "",
	});

	return markBuildRunning(job.buildJobId, `native:${job.buildJobId}`);
}

/**
 * Dispatch a single build job to its arcd runner pool via workflow_dispatch.
 * Returns a dispatch correlation id. GitHub's dispatch endpoint returns 204
 * with no run id, so we correlate on (repo, sha, target) which is carried as
 * a workflow input and echoed back by the build workflow on completion.
 */
async function dispatchWorkflow(
	provider: ResolvedProvider["provider"],
	job: BuildJob,
	build: BuildConfig,
): Promise<string> {
	const [owner, name] = job.repo.split("/");
	if (!owner || !name) {
		throw new Error(`Invalid repo "${job.repo}": expected "owner/name" format`);
	}
	const octokit = authGithub(provider);
	const dispatchId = `${job.repo}@${job.sha}#${job.target}`;
	await octokit.rest.actions.createWorkflowDispatch({
		owner,
		repo: name,
		workflow_id: PLATFORM_BUILD_WORKFLOW,
		ref: job.branch,
		inputs: {
			"build-job-id": job.buildJobId,
			target: job.target,
			"runner-pool": job.runnerPool,
			image: job.image,
			dockerfile: build.dockerfile,
			context: build.context,
			push: String(build.push),
		},
	});
	return dispatchId;
}

/**
 * Dispatch one job by the resolved mode. Returns the correlation id stored on
 * the buildJob row (`native:<id>` or `repo@sha#target`).
 */
async function dispatchBuild(
	provider: ResolvedProvider["provider"],
	job: BuildJob,
	build: BuildConfig,
	installationId: string,
): Promise<string> {
	const mode = await resolveDispatchMode(build, job.runnerPool);
	if (mode === "native") {
		return dispatchNative(job, build, installationId);
	}
	return dispatchWorkflow(provider, job, build);
}

/**
 * Schedule all builds for a triggering commit. Idempotent on (repo, sha,
 * target): a re-delivery of the same webhook does not enqueue duplicates.
 * Returns null when the repo has no `.platform.yml` (it stays on GHA).
 */
export async function scheduleBuilds(
	input: ScheduleInput,
): Promise<ScheduleResult | null> {
	const { provider, organizationId } = await resolveProvider(
		input.installationId,
	);

	const config = await fetchPlatformConfig(provider, input.repo, input.sha);
	if (!config) return null;

	const jobs: BuildJob[] = [];
	// One job per (image, matrix entry). The target key includes the image name
	// for multi-image repos so two images on the same os/arch don't collide;
	// legacy single-build repos (name "") keep the bare `os/arch` target.
	for (const build of config.builds) {
		for (const entry of build.matrix) {
			const arch = `${entry.os}/${entry.arch}`;
			const target = build.name ? `${build.name}:${arch}` : arch;
			const existing = await findBuildJobByTarget(
				input.repo,
				input.sha,
				target,
			);
			if (existing) {
				jobs.push(existing);
				continue;
			}
			const tag = resolveTag(build.tagPattern, {
				sha: input.sha,
				branch: input.branch,
			});
			const job = await createBuildJob({
				repo: input.repo,
				sha: input.sha,
				ref: input.ref,
				branch: input.branch,
				target,
				runnerPool: runnerPoolFor(orgLabel(input.repo), entry),
				image: `${build.image}:${tag}`,
				organizationId,
				status: "queued",
				rolloutStatus: "skipped",
			});
			const dispatchId = await dispatchBuild(
				provider,
				job,
				build,
				input.installationId,
			);
			jobs.push(await markBuildRunning(job.buildJobId, dispatchId));
		}
	}

	return { organizationId, config, jobs };
}

/**
 * arcd pool labels are keyed by GitHub org (`hanzoai`, `luxfi`, ...), which
 * is the first path segment of `owner/repo`. The runner-pool label uses the
 * org login verbatim.
 */
function orgLabel(repo: string): string {
	const [owner] = repo.split("/");
	if (!owner) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot derive runner pool org from repo "${repo}"`,
		});
	}
	return owner;
}
