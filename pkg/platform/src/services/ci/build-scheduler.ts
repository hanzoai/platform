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
 * arcd-protocol decision (documented in PR + docs/PLATFORM_CI.md):
 *   arcd polls GitHub's own Actions job queue (JIT runners) — there is no
 *   standalone arcd job-acceptance API. Rather than reimplement GitHub's
 *   runner-registration/job-acquire protocol as a server inside platform
 *   (multi-week effort), the scheduler dispatches builds to the EXISTING
 *   self-hosted arcd pools via `workflow_dispatch`, pinning the runner pool
 *   per matrix entry. Platform owns the system-of-record (this module + the
 *   buildJob table) and the deploy decision; the build muscle stays on our
 *   own hardware. A native arcd long-poll protocol is the next iteration.
 */
import { authGithub } from "@hanzo/platform/utils/providers/github";
import { TRPCError } from "@trpc/server";
import { findGithubByInstallationId } from "../github";
import type { BuildJob } from "./build-job";
import {
	createBuildJob,
	findBuildJobByTarget,
	markBuildRunning,
} from "./build-job";
import {
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
 * Dispatch a single build job to its arcd runner pool via workflow_dispatch.
 * Returns a dispatch correlation id. GitHub's dispatch endpoint returns 204
 * with no run id, so we correlate on (repo, sha, target) which is carried as
 * a workflow input and echoed back by the build workflow on completion.
 */
async function dispatchBuild(
	provider: ResolvedProvider["provider"],
	job: BuildJob,
	config: PlatformConfig,
): Promise<string> {
	const [owner, name] = job.repo.split("/");
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
			runnerPool: runnerPoolFor(orgLabel(input.repo), entry),
			image: `${config.build.image}:${tag}`,
			organizationId,
			status: "queued",
			rolloutStatus: "skipped",
		});
		const dispatchId = await dispatchBuild(provider, job, config);
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
