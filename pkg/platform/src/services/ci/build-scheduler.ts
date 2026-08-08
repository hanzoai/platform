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
 * Dispatch — ONE way: the in-cluster BuildKit Job (`buildkit-job.launchBuildJob`).
 * Platform builds on its OWN runner pool and is the system-of-record (this
 * module + the buildJob table) and the deploy decision. There is no GitHub
 * Actions path and no `workflow_dispatch` fallback — the prior fallback pointed
 * at offline GitHub runners and silently no-op'd, so it was removed. A build
 * either launches a BuildKit Job in-cluster or fails loud.
 */
import {
	appEnvOctokit,
	authGithub,
} from "@hanzo/platform/utils/providers/github";
import { TRPCError } from "@trpc/server";
import { findGithubByInstallationId } from "../github";
import { type HanzoGitConfig, hanzoGitConfig } from "../hanzo-git";
import type { BuildJob } from "./build-job";
import {
	createBuildJob,
	findBuildJobByTarget,
	updateBuildJob,
} from "./build-job";
import { launchBuildJob } from "./buildkit-job";
import { assertBuildableFromCanonicalSource } from "./forge-source";
import { githubReachability, readForgeRepoFacts } from "./forge-source-probe";
import {
	type BuildArch,
	type BuildOS,
	isBuildableArch,
	type PlatformConfig,
	parsePlatformConfig,
	resolveTag,
	runnerPoolFor,
} from "./platform-config";

/**
 * Where to read `hanzo.yml` from, and which organization owns the result.
 *
 * Data, not a callback: a delivery states WHICH forge vouched for it, and the
 * scheduler resolves that to an org + a config reader. GitHub identifies
 * itself with the App installation id carried in the payload; Hanzo Git has
 * no such concept — it is our own single forge, so it identifies itself and
 * carries only the repo name it uses. Both land on one `resolveSource`, so
 * the build path below is identical for every forge — one way to build,
 * several front doors.
 */
export type ConfigSource =
	| { forge: "github"; installationId: string }
	| {
			forge: "hanzo-git";
			/** `owner/repo` as the FORGE names it — see DecodedWebhook.sourceRepo. */
			sourceRepo: string;
	  };

export interface ScheduleInput {
	/** Which provider vouched for this delivery, and how to read its config. */
	source: ConfigSource;
	/** Canonical `owner/repo` (org already mapped). Keys the buildJob row. */
	repo: string;
	sha: string;
	ref: string;
	branch: string;
	/**
	 * The org the CALLER is allowed to act as. Set it on any path where the
	 * caller chooses `source` — the source selects the principal, so without
	 * this a caller picks which org it builds and deploys as.
	 *
	 * Webhook paths leave it undefined: there the forge authenticates the
	 * delivery (HMAC) and the principal comes from the installation binding,
	 * not from anything the sender picked.
	 */
	requireOrganizationId?: string;
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
 * Decode + parse a base64 GitHub `getContent` file response.
 *
 * Null means the file exists and declares no build — same signal as no file at
 * all, because to this lane they mean the same thing.
 */
function parseContentResponse(
	data: { content?: string; encoding?: string },
	where: string,
): PlatformConfig | null {
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

/**
 * Fetch the repo's platform config from Hanzo Git at a specific ref.
 *
 * Hanzo Git's contents API is GitHub-shaped in its BODY — same
 * `{content, encoding:"base64"}` — so `parseContentResponse` is shared verbatim
 * rather than re-implemented. It is NOT GitHub-shaped in its PREFIX: Hanzo Git
 * serves `/v1/`, and `/api/v1/` returns 404 "Not found." (measured, with the
 * `/v1/` control returning 200 and the file). This read asked for `/api/v1/`,
 * and a 404 here is the "repo has not opted in" signal, so the miss was
 * indistinguishable from a repo with no config: every forge push answered
 * `202 Accepted; <repo> has no hanzo.yml (nothing to build)` and built nothing.
 *
 * `repo` here is the FORGE-native `owner/name` (`hanzo/kms`), not the canonical
 * one, because we are addressing the forge. Returns null when the repo has not
 * opted in.
 */
export async function fetchPlatformConfigFromHanzoGit(
	cfg: Pick<HanzoGitConfig, "url" | "token">,
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
	const headers: Record<string, string> = { Accept: "application/json" };
	if (cfg.token) headers.Authorization = `token ${cfg.token}`;
	for (const path of CONFIG_NAMES) {
		const url = `${cfg.url}/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path}?ref=${encodeURIComponent(ref)}`;
		const res = await fetch(url, { headers });
		if (res.status === 404) continue;
		if (!res.ok) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Failed to read ${path} from ${repo}@${ref}: Hanzo Git returned ${res.status}`,
			});
		}
		return parseContentResponse(
			(await res.json()) as { content?: string; encoding?: string },
			`${path} in ${repo}@${ref}`,
		);
	}
	return null;
}

/**
 * The one file that means "hanzoai/ci runs this repo's pipeline". The forge
 * resolves `.hanzo/workflows`, so a caller here is a caller the forge will
 * actually execute.
 */
const CI_CALLER_PATH = ".hanzo/workflows/cicd.yml";

/**
 * Does hanzoai/ci own this repo's build at `ref`?
 *
 * A push to the forge fans out to BOTH lanes. The forge-wide system webhook
 * reaches here and builds from `images:`; the same push also starts the repo's
 * `.hanzo/workflows/cicd.yml`, which runs `hanzoai/ci` — the `test:` gate, the
 * structural refusals, `gover`, `publishable`. Only one of those two lanes is
 * gated, and BOTH push the image.
 *
 * Measured on hanzoai/cloud@7c50638e: run 36368's `Test (per hanzo.yml)` step
 * failed, ci therefore skipped its `image` job — and this lane built
 * `ghcr.io/hanzoai/cloud:sha-7c50638eb180` with `push=true` anyway. The gate
 * refused to publish and the artifact was published. A gate another lane can
 * walk around is not a gate.
 *
 * So when a repo has a ci caller, this lane yields: ci builds it, on the same
 * BuildKit, through `mode: delegate` if it wants this pool. Nothing is lost —
 * for a repo with `images:` and a caller, ci's own build+push step already
 * produces the same tags, so today the two lanes are redundant for exactly the
 * repos where the ungated one is dangerous. The 17 repos with a hanzo.yml and
 * no caller keep building here, unchanged, and gain the gate the moment one is
 * added. No flag, no list to maintain: the presence of the file IS the answer.
 *
 * This reads ONE fact — does the file exist — and no key inside it. Parsing
 * `test:` here would be a third implementation of a schema that already has
 * two, and it could not work anyway: the gate needs per-repo KMS names, and
 * this deployment's KMS access is a KMSSecret CRD with a statically declared
 * key list that cannot serve a name discovered at some SHA.
 *
 * TWO conditions, because the file is a CLAIM and Actions is whether the forge
 * will honour it. hanzoai/postgres and hanzoai/stream both carry the caller and
 * both have `has_actions: false` — Actions is administratively off, their
 * cicd.yml has never produced a single run, and this lane is the only thing
 * building them. Yielding on the file alone would have stopped them dead, on
 * repos being pushed to the same day. A repo that cannot run ci is not a repo
 * ci owns.
 *
 * Fail OPEN on a transport error, and on anything unproven. A forge blip must
 * not silently stop builds fleet-wide; the redundant-build state it falls back
 * to is the status quo and is survivable, a stuck fleet is not.
 */
export async function ciOwnsBuild(
	cfg: Pick<HanzoGitConfig, "url" | "token">,
	repo: string,
	ref: string,
): Promise<boolean> {
	const [owner, name] = repo.split("/");
	if (!owner || !name) return false;
	const headers: Record<string, string> = { Accept: "application/json" };
	if (cfg.token) headers.Authorization = `token ${cfg.token}`;
	const base = `${cfg.url}/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
	try {
		const repoRes = await fetch(base, { headers });
		if (!repoRes.ok) return false;
		const { has_actions } = (await repoRes.json()) as { has_actions?: boolean };
		if (has_actions === false) return false;
		const caller = await fetch(
			`${base}/contents/${CI_CALLER_PATH}?ref=${encodeURIComponent(ref)}`,
			{ headers },
		);
		return caller.ok;
	} catch {
		return false;
	}
}

/**
 * Resolve a {@link ConfigSource} to the owning organization plus the repo's
 * config at `sha`. The ONLY place the build path knows which forge it is
 * talking to; everything after this point is forge-agnostic.
 */
async function resolveSource(
	source: ConfigSource,
	repo: string,
	sha: string,
): Promise<{ organizationId: string; config: PlatformConfig | null }> {
	if (source.forge === "hanzo-git") {
		const cfg = hanzoGitConfig();
		return {
			organizationId: cfg.organizationId,
			config: await fetchPlatformConfigFromHanzoGit(
				cfg,
				source.sourceRepo,
				sha,
			),
		};
	}
	const { provider, organizationId } = await resolveProvider(
		source.installationId,
	);
	return {
		organizationId,
		config: await fetchPlatformConfig(provider, repo, sha),
	};
}

/** Build-target arch from a target key (`linux/amd64`, `web:linux/amd64`). */
function archOf(target: string): BuildArch {
	return target.split("/").pop() === "arm64" ? "arm64" : "amd64";
}

/**
 * Dispatch one queued build to the build muscle: launch its BuildKit Job and
 * transition the row to `running`, recording the Job name (the build-watcher
 * polls it) and a `buildkit:<jobName>` correlation id.
 */
async function dispatchBuild(
	job: BuildJob,
	gitRef: string,
	opts: {
		dockerfile?: string;
		context?: string;
		dockerTarget?: string;
		buildArgs?: Record<string, string>;
	},
): Promise<BuildJob> {
	const launch = await launchBuildJob({
		repo: job.repo,
		gitRef,
		image: job.image,
		dockerfile: opts.dockerfile,
		context: opts.context,
		dockerTarget: opts.dockerTarget,
		buildArgs: opts.buildArgs,
		arch: archOf(job.target),
		buildJobId: job.buildJobId,
	});
	return updateBuildJob(job.buildJobId, {
		status: "running",
		dispatchId: `buildkit:${launch.jobName}`,
		buildJobName: launch.jobName,
		startedAt: new Date().toISOString(),
	});
}

/**
 * Spec for a GitHub-App-free direct build. The webhook path derives all of
 * this from `hanzo.yml` at a SHA; this lets an operator (or a repo not wired to
 * the GitHub App) enqueue a build by stating it explicitly. The downstream is
 * identical — `createBuildJob` + the BuildKit build muscle — so there is exactly
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
	/**
	 * `--build-arg` pairs for the Dockerfile. `VERSION` is already derived from
	 * the destination tag, so state it here only to override that.
	 */
	buildArgs?: Record<string, string>;
	push?: boolean;
	/** Build target os/arch (default linux/amd64). Drives the pool + platform. */
	os?: BuildOS;
	arch?: BuildArch;
	organizationId: string;
}

/**
 * Enqueue a single build directly, WITHOUT a GitHub App or webhook. Creates the
 * buildJob row and launches its BuildKit Job in-cluster. Idempotent on
 * (repo, sha, target, image): re-enqueuing the same image returns the existing
 * job; asking for a different image from the same commit builds it.
 */
export async function enqueueDirectBuild(
	input: DirectBuildInput,
): Promise<BuildJob> {
	const os: BuildOS = input.os ?? "linux";
	const arch: BuildArch = input.arch ?? "amd64";
	// arm64 is paused (no DOKS arm64 pool). Reject an explicit arm64 request
	// loudly rather than launch a Job that pends forever on a non-existent pool.
	// The direct front door is an operator/tool asking for a specific arch, so a
	// clear error beats a silent wedge. Resumes when arm64 rejoins BUILDABLE_ARCHES.
	if (!isBuildableArch(arch)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `arch "${arch}" is paused: DOKS has no arm64 droplets, so an arm64 build targets a non-existent runner pool and never schedules. Build amd64 only until DigitalOcean ships arm64.`,
		});
	}
	const target = `${os}/${arch}`;
	const branch = input.branch ?? "main";
	const ref = input.ref ?? `refs/heads/${branch}`;

	// Keyed on the image too. Without it a second direct build of the same
	// commit to a DIFFERENT image returned the first job untouched, so the
	// caller was handed a success carrying an image it never asked for.
	const existing = await findBuildJobByTarget(
		input.repo,
		input.sha,
		target,
		input.image,
	);
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
		buildArgs: input.buildArgs,
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
	const { organizationId, config } = await resolveSource(
		input.source,
		input.repo,
		input.sha,
	);
	// The principal is whatever `source` resolved to. When the caller chose
	// `source`, it therefore chose the principal — so confirm it is the org the
	// caller is actually entitled to act as, BEFORE any build or deploy is
	// scheduled against that org's namespaces. Exact match, fail closed.
	if (
		input.requireOrganizationId !== undefined &&
		input.requireOrganizationId !== organizationId
	) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message:
				"Refusing to schedule a build for another organization — the build source resolves to an org you are not acting as",
		});
	}
	if (!config) return null;

	// The forge is what this path reads; GitHub is where the code was reviewed.
	// Nothing keeps those equal on its own — a repo whose mirror row is gone
	// serves its last state forever, and the build off it looks exactly like a
	// healthy one. So before enqueuing anything, confirm this commit is on the
	// canonical source. Refuse loudly if it is not; never repair it here.
	//
	// Only for forge-triggered builds: a GitHub delivery IS the canonical side,
	// so there is nothing to compare it against.
	if (input.source.forge === "hanzo-git") {
		const cfg = hanzoGitConfig();
		const why = await assertBuildableFromCanonicalSource({
			forgeRepo: input.source.sourceRepo,
			sha: input.sha,
			declared: config.source,
			facts: await readForgeRepoFacts(cfg, input.source.sourceRepo),
			probe: githubReachability,
		});
		console.info(`[build] source check passed: ${why}`);
	}

	const jobs: BuildJob[] = [];
	// One job per (image, matrix entry). The target key includes the image name
	// for multi-image repos so two images on the same os/arch don't collide;
	// legacy single-build repos (name "") keep the bare `os/arch` target.
	for (const build of config.builds) {
		for (const entry of build.matrix) {
			// arm64 is paused (no DOKS arm64 pool). Skip its matrix entries so a
			// dual-arch repo still builds its amd64 image instead of wedging an
			// unschedulable arm64 Job on a non-existent pool. Same "skip, don't
			// fail the push" shape as the empty-{{git.tag}} skip below. Re-add
			// "arm64" to BUILDABLE_ARCHES (platform-config) when DO ships arm64.
			if (!isBuildableArch(entry.arch)) continue;
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
				ref: input.ref,
			});
			// A `{{git.tag}}` pattern has no image name on a branch push. Skip the
			// target rather than inventing one — the push still succeeds, and the
			// versioned image appears when the tag itself is pushed.
			if (tag === null) continue;
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
					buildArgs: build.buildArgs,
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
