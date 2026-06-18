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
 *   Per matrix entry the scheduler resolves an ORDERED preference list of
 *   pools — the repo's own org pool first, the shared `hanzo` pool second —
 *   to a single `BuildTarget` (see `resolveTarget`). The first pool with a
 *   live runner wins; if none has one, it falls back to `workflow_dispatch`.
 *
 *   The legacy `workflow_dispatch` path remains for migration: it is used when
 *   the repo's `.platform.yml` sets `build.dispatch: workflow_dispatch`, when
 *   the WORKFLOW_DISPATCH_FALLBACK env forces it, or transparently when NO
 *   candidate pool has a live runner yet (so a build is never stranded). As
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
	type PlatformConfig,
	parsePlatformConfig,
	resolveTag,
	runnerPoolFor,
} from "./platform-config";

/** Canonical reusable workflow filename platform dispatches build jobs to. */
const PLATFORM_BUILD_WORKFLOW = "platform-build.yml";

/**
 * Org label of the shared runner tier. A `hanzo-<os>-<arch>` pool backs any
 * repo whose own org has not (yet) registered a runner for the target. This is
 * the ONE place that name lives; the resolver itself is org-agnostic.
 */
const SHARED_RUNNER_ORG = "hanzo";

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
 * Fetch `.platform.yml` from the repo at a specific ref. Returns the parsed
 * + validated config, or null when the repo has not opted in (no file).
 * Any other failure (bad YAML, schema violation, API error) throws.
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
	try {
		const res = await octokit.rest.repos.getContent({
			owner,
			repo: name,
			path: ".platform.yml",
			ref,
		});
		const data = res.data as { content?: string; encoding?: string };
		if (!data.content || data.encoding !== "base64") {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `.platform.yml in ${repo}@${ref} is not a regular file`,
			});
		}
		const text = Buffer.from(data.content, "base64").toString("utf8");
		return parsePlatformConfig(text);
	} catch (err) {
		const e = err as { status?: number };
		if (e.status === 404) return null;
		if (err instanceof TRPCError) throw err;
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Failed to read .platform.yml from ${repo}@${ref}: ${(err as Error).message}`,
		});
	}
}

/**
 * Where a build runs: a specific native pool, or the workflow_dispatch fallback.
 */
export type BuildTarget =
	| { kind: "native"; pool: string }
	| { kind: "workflow_dispatch" };

/**
 * Resolve a build to its dispatch target over an ORDERED preference list of
 * pools. One concern, one way:
 *   (a) the repo pins `dispatch: workflow_dispatch`               → fallback
 *   (b) WORKFLOW_DISPATCH_FALLBACK forces the GHA path globally   → fallback
 *   (c) the FIRST pool in `pools` with a live registered runner   → native
 *   (d) no pool has a live runner                                 → fallback
 *
 * Priority between candidate pools (e.g. tenant before shared) is encoded
 * ONLY as the order of `pools`. The resolver does not know what "tenant" or
 * "shared" means and never reads organizationId — that policy lives at the
 * call site. Orthogonal, composable, and testable in isolation.
 */
export async function resolveTarget(
	config: PlatformConfig,
	pools: string[],
	now: number = Date.now(),
): Promise<BuildTarget> {
	if (config.build.dispatch === "workflow_dispatch") {
		return { kind: "workflow_dispatch" };
	}
	if (process.env.WORKFLOW_DISPATCH_FALLBACK === "true") {
		return { kind: "workflow_dispatch" };
	}
	for (const pool of pools) {
		if (await poolHasLiveRunner(pool, now)) {
			return { kind: "native", pool };
		}
	}
	return { kind: "workflow_dispatch" };
}

/**
 * Dispatch a single build job natively: enqueue it onto the long-poll fabric
 * for its pool. An arcd runner pulls it via POST /v1/arcd/poll. Returns the
 * dispatch correlation id (`native:<buildJobId>`).
 */
function dispatchNative(
	job: BuildJob,
	config: PlatformConfig,
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
		dockerfile: config.build.dockerfile,
		context: config.build.context,
		push: config.build.push,
		installationId,
	});
	return `native:${job.buildJobId}`;
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
	config: PlatformConfig,
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
			dockerfile: config.build.dockerfile,
			context: config.build.context,
			push: String(config.build.push),
		},
	});
	return dispatchId;
}

/**
 * Dispatch one job by an already-resolved target — the resolver runs once, at
 * the call site, so the target and the job's `runnerPool` never diverge. A
 * `native` target enqueues onto `job.runnerPool` (= `target.pool`); a
 * `workflow_dispatch` target hands off to GHA with `job.runnerPool` (= the
 * tenant pool) as the runner-pool input. Returns the correlation id stored on
 * the buildJob row (`native:<id>` or `repo@sha#target`).
 */
async function dispatchBuild(
	provider: ResolvedProvider["provider"],
	job: BuildJob,
	config: PlatformConfig,
	target: BuildTarget,
	installationId: string,
): Promise<string> {
	if (target.kind === "native") {
		return dispatchNative(job, config, installationId);
	}
	return dispatchWorkflow(provider, job, config);
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
	for (const entry of config.build.matrix) {
		const target = `${entry.os}/${entry.arch}`;
		const existing = await findBuildJobByTarget(input.repo, input.sha, target);
		if (existing) {
			jobs.push(existing);
			continue;
		}
		// Preference order: the repo's own org pool first, the shared `hanzo`
		// pool second. de-dup so a hanzoai/* repo (whose org pool IS the shared
		// pool) does not probe the same pool twice. The resolver reads this
		// order as the tenant-before-shared priority — it is told nothing else.
		const tenantPool = runnerPoolFor(orgLabel(input.repo), entry);
		const sharedPool = runnerPoolFor(SHARED_RUNNER_ORG, entry);
		const pools = [...new Set([tenantPool, sharedPool])];
		const resolved = await resolveTarget(config, pools);

		const tag = resolveTag(config.build.tagPattern, {
			sha: input.sha,
			branch: input.branch,
		});
		const job = await createBuildJob({
			repo: input.repo,
			sha: input.sha,
			ref: input.ref,
			branch: input.branch,
			target,
			// Native lands on the resolved pool; the workflow_dispatch fallback
			// records the tenant pool as the runner-pool the GHA job requests.
			runnerPool: resolved.kind === "native" ? resolved.pool : tenantPool,
			image: `${config.build.image}:${tag}`,
			organizationId,
			status: "queued",
			rolloutStatus: "skipped",
		});
		const dispatchId = await dispatchBuild(
			provider,
			job,
			config,
			resolved,
			input.installationId,
		);
		jobs.push(await markBuildRunning(job.buildJobId, dispatchId));
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
