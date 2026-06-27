/**
 * BuildScheduler — platform-native CI/CD orchestrator.
 *
 * Flow (one call per accepted webhook):
 *   1. Authenticate the delivery against the provider's installation id.
 *   2. Fetch `hanzo.yml` from the repo at the triggering SHA.
 *   3. Validate it; enqueue one `buildJob` row per matrix entry, keyed
 *      uniquely by (repo, sha, target).
 *   4. Dispatch each job to the build muscle.
 *
 * Dispatch — ONE way: the in-cluster Kaniko Job (`kaniko-job.launchBuildJob`).
 * Platform builds on its OWN runner pool and is the system-of-record (this
 * module + the buildJob table) and the deploy decision. There is no GitHub
 * Actions path and no `workflow_dispatch` fallback — the prior fallback pointed
 * at offline GitHub runners and silently no-op'd, so it was removed. A build
 * either launches a Kaniko Job in-cluster or fails loud.
 */
import {
	appEnvOctokit,
	authGithub,
} from "@hanzo/platform/utils/providers/github";
import { TRPCError } from "@trpc/server";
import { findGithubByInstallationId } from "../github";
import type { BuildJob } from "./build-job";
import {
	createBuildJob,
	findBuildJobByTarget,
	updateBuildJob,
} from "./build-job";
import { launchBuildJob } from "./kaniko-job";
import {
	type BuildArch,
	type BuildConfig,
	type BuildOS,
	type PlatformConfig,
	parsePlatformConfig,
	resolveTag,
	runnerPoolFor,
} from "./platform-config";

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

/** Decode + parse a base64 GitHub `getContent` file response. */
function parseContentResponse(
	data: { content?: string; encoding?: string },
	where: string,
): PlatformConfig {
	if (!data.content || data.encoding !== "base64") {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `${where} is not a regular file`,
		});
	}
	const text = Buffer.from(data.content, "base64").toString("utf8");
	return parsePlatformConfig(text);
}

/**
 * Fetch the repo's platform config at a specific ref via the GitHub App,
 * trying each name in `CONFIG_NAMES` order. Returns null when the repo has not
 * opted in (no config under any name). Any other failure throws.
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
			return parseContentResponse(
				res.data as { content?: string; encoding?: string },
				`${path} in ${repo}@${ref}`,
			);
		} catch (err) {
			const e = err as { status?: number };
			if (e.status === 404) continue;
			if (err instanceof TRPCError) throw err;
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Failed to read ${path} from ${repo}@${ref}: ${(err as Error).message}`,
			});
		}
	}
	return null;
}

/**
 * Fetch the repo's platform config WITHOUT a webhook installation context —
 * for the App-free paths (the direct `/v1/arcd/enqueue` trigger and the
 * build-watcher's post-build deploy decision). Authenticates as the platform's
 * own GitHub App installation via `appEnvOctokit` (the `GITHUB_APP_*` env,
 * synced from KMS `hanzo/platform`), replacing the rate-limited `GH_TOKEN` PAT
 * — the same App credential the release-reader uses. Returns null when the repo
 * has no config (build-only). Throws on bad config.
 */
export async function fetchPlatformConfigByToken(
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
	const octokit = appEnvOctokit();
	for (const path of CONFIG_NAMES) {
		try {
			const res = await octokit.rest.repos.getContent({
				owner,
				repo: name,
				path,
				ref,
			});
			return parseContentResponse(
				res.data as { content?: string; encoding?: string },
				`${path} in ${repo}@${ref}`,
			);
		} catch (err) {
			const e = err as { status?: number };
			if (e.status === 404) continue;
			if (err instanceof TRPCError) throw err;
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Failed to read ${path} from ${repo}@${ref}: ${(err as Error).message}`,
			});
		}
	}
	return null;
}

/** Build-target arch from a target key (`linux/amd64`, `web:linux/amd64`). */
function archOf(target: string): BuildArch {
	return target.split("/").pop() === "arm64" ? "arm64" : "amd64";
}

/**
 * Dispatch one queued build to the build muscle: launch its Kaniko Job and
 * transition the row to `running`, recording the Job name (the build-watcher
 * polls it) and a `kaniko:<jobName>` correlation id.
 */
async function dispatchBuild(
	job: BuildJob,
	gitRef: string,
	opts: { dockerfile?: string; context?: string; dockerTarget?: string },
): Promise<BuildJob> {
	const launch = await launchBuildJob({
		repo: job.repo,
		gitRef,
		image: job.image,
		dockerfile: opts.dockerfile,
		context: opts.context,
		dockerTarget: opts.dockerTarget,
		arch: archOf(job.target),
		buildJobId: job.buildJobId,
	});
	return updateBuildJob(job.buildJobId, {
		status: "running",
		dispatchId: `kaniko:${launch.jobName}`,
		buildJobName: launch.jobName,
		startedAt: new Date().toISOString(),
	});
}

/**
 * Spec for a GitHub-App-free direct build. The webhook path derives all of
 * this from `hanzo.yml` at a SHA; this lets an operator (or a repo not wired to
 * the GitHub App) enqueue a build by stating it explicitly. The downstream is
 * identical — `createBuildJob` + the Kaniko build muscle — so there is exactly
 * ONE build path, two front doors.
 */
export interface DirectBuildInput {
	/** owner/name — used to derive the arcd pool's org segment + git context. */
	repo: string;
	sha: string;
	ref?: string;
	branch?: string;
	/** Fully-resolved image ref to build + push, e.g. ghcr.io/hanzoai/x:tag. */
	image: string;
	dockerfile?: string;
	context?: string;
	/** Optional Docker build stage (`--target`) for multi-stage Dockerfiles. */
	dockerTarget?: string;
	push?: boolean;
	/** Build target os/arch (default linux/amd64). Drives the pool + platform. */
	os?: BuildOS;
	arch?: BuildArch;
	organizationId: string;
}

/**
 * Enqueue a single build directly, WITHOUT a GitHub App or webhook. Creates the
 * buildJob row and launches its Kaniko Job in-cluster. Idempotent on
 * (repo, sha, target): re-enqueuing the same target returns the existing job.
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

	const job = await createBuildJob({
		repo: input.repo,
		sha: input.sha,
		ref,
		branch,
		target,
		runnerPool: runnerPoolFor(orgLabel(input.repo), { os, arch }),
		image: input.image,
		organizationId: input.organizationId,
		status: "queued",
		rolloutStatus: "skipped",
	});

	return dispatchBuild(job, ref, {
		dockerfile: input.dockerfile,
		context: input.context,
		dockerTarget: input.dockerTarget,
	});
}

/**
 * Schedule all builds for a triggering commit. Idempotent on (repo, sha,
 * target): a re-delivery of the same webhook does not enqueue duplicates.
 * Returns null when the repo has no `hanzo.yml` (it opted out).
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
			jobs.push(
				await dispatchBuild(job, input.ref, {
					dockerfile: build.dockerfile,
					context: build.context,
				}),
			);
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
