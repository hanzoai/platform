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
import { authGithub } from "@hanzo/platform/utils/providers/github";
import { TRPCError } from "@trpc/server";
import { findGithubByInstallationId } from "../github";
import {
	commitAt,
	commitName,
	commitProblem,
	forgeReader,
	type HanzoGitConfig,
	hanzoGitConfig,
	refProblem,
	repoName,
	repoProblem,
} from "../hanzo-git";
import { destinationProblem, org, orgId, ownerOf, tagProblem } from "../org";
import type { BuildJob } from "./build-job";
import {
	createBuildJob,
	findBuildJobByTarget,
	updateBuildJob,
} from "./build-job";
import { fetchBuildSecrets } from "./build-secrets";
import { launchBuildJob } from "./buildkit-job";
import { assertBuildableFromCanonicalSource } from "./forge-source";
import { githubReachability, readForgeRepoFacts } from "./forge-source-probe";
import { imageName, imageOrg } from "./image-ref";
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
 * Which forge vouched for a delivery, and how to read a config from it.
 *
 * Data, not a callback: GitHub identifies itself with the App installation id
 * carried in the payload; Hanzo Git has no such concept — it is our own single
 * forge and identifies itself. Both land on one `resolveSource`, so the build
 * path below is identical for every forge — one way to build, several front
 * doors. WHICH repository is read is {@link ScheduleInput.repo}, the same one
 * the build clones.
 */
export type ConfigSource =
	| { forge: "github"; installationId: string }
	| { forge: "hanzo-git" };

export interface ScheduleInput {
	/** Which provider vouched for this delivery, and how to read its config. */
	source: ConfigSource;
	/**
	 * `owner/name` as the delivering forge names it — the ONE repository this
	 * build reads. Its `hanzo.yml` says what to build, its git context is what
	 * BuildKit clones, and it keys the buildJob row, so what runs is what the
	 * config described.
	 */
	repo: string;
	/**
	 * The branch or tag this build is about, whole — `refs/heads/main`.
	 *
	 * The ONE git name a caller states, and every decision downstream that is
	 * not about the code itself reads it: whether an image may carry a version
	 * ({@link resolveTag}), and whether a deploy may follow (`promoteBuild`). A
	 * name, not a commit — a name is a thing the forge can be asked about.
	 */
	ref: string;
	/**
	 * The org the CALLER is allowed to act as. Set it on any path where a caller
	 * states one, so a claim the repository does not bear out is refused.
	 *
	 * Webhook paths leave it undefined: there the forge authenticates the
	 * delivery (HMAC) and there is nobody to ask.
	 */
	requireOrganizationId?: string;
}

export interface ScheduleResult {
	organizationId: string;
	config: PlatformConfig;
	jobs: BuildJob[];
}

/**
 * A call that built nothing, and which of the two ordinary reasons it was.
 *
 * Both are healthy answers to a healthy push, and they are different sentences:
 * a repo that declares no image is not a repo whose images hanzoai/ci builds,
 * and a caller reporting the first when it was the second sends a reader looking
 * for a file that is right there. So the reason travels WITH the answer —
 * `declined` for a caller that branches, `why` for one that reports — written
 * once, where it is known, rather than guessed at each door.
 */
export interface Declined {
	declined: "no-image" | "ci-owns";
	why: string;
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
 * The config a finished build was described by.
 *
 * A build's `deploy:`, `e2e:` and `publish:` come from the same document that
 * said what to build, so this reads the repository the build cloned at the
 * commit it built — the two identifiers already on the row. Everything a build
 * clones it clones from the forge, so that is where this reads.
 */
export async function fetchBuiltConfig(
	repo: string,
	sha: string,
): Promise<PlatformConfig | null> {
	return fetchPlatformConfigFromHanzoGit(forgeReader(), repo, sha);
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
 * The forge path an image spells for itself: `ghcr.io/hanzoai/kms` → `hanzoai/kms`.
 *
 * An organization has several forge spellings and ONE registry namespace, so an
 * image name is the one path every repository publishing it agrees on.
 * `hanzo/platform` and `hanzoai/platform` are two repositories that publish
 * `ghcr.io/hanzoai/platform`, and a rule about the image has to be asked about
 * the image rather than about whichever of the two a push arrived under.
 *
 * Undefined for a namespace no organization here owns — those images are
 * somebody else's, and their repositories are not ours to look up.
 */
function repoNaming(image: string): string | undefined {
	const ns = imageOrg(image);
	const name = imageName(image);
	return ns && name && org(ns) ? repoName(`${ns}/${name}`) : undefined;
}

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
 *
 * Asked of the repository being pushed AND of the repository each declared image
 * names ({@link repoNaming}), because the thing being protected is the image.
 * One image name has several forge paths — `hanzo/platform`, `hanzoai/platform` —
 * and a check keyed on the path let a caller pick the twin that carries no
 * caller file and publish the gated image from the ungated lane. Keyed on the
 * image, both paths ask the same question and get the same answer.
 *
 * Read at each repository's DEFAULT branch, which is the only place all of them
 * have one. It is also the honest tense: what runs a repo's pipeline is a fact
 * about the repo now, not about the commit in hand — read at the commit, a push
 * that merely deletes the caller file on a side branch hands itself this lane.
 */
export async function ciOwnsBuild(
	cfg: Pick<HanzoGitConfig, "url" | "token">,
	repos: readonly string[],
): Promise<boolean> {
	const owned = await Promise.all(
		[...new Set(repos)].map((repo) => owns(cfg, repo)),
	);
	return owned.some(Boolean);
}

/** {@link ciOwnsBuild} for one repository path. */
async function owns(
	cfg: Pick<HanzoGitConfig, "url" | "token">,
	repo: string,
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
		const caller = await fetch(`${base}/contents/${CI_CALLER_PATH}`, {
			headers,
		});
		return caller.ok;
	} catch {
		return false;
	}
}

/**
 * Read the repo's config at `sha` through whichever forge vouched for the
 * delivery. The ONLY place the build path knows which forge it is talking to;
 * everything after this point is forge-agnostic.
 *
 * A source is a way to READ, and that is all it is. Who the build acts as comes
 * from {@link principal}, off the repository, on every lane — an installation
 * says which credential opens a file, and a credential is not an identity. Read
 * the other way round, a GitHub installation bound to one organization would
 * hand that organization's principal to a build of any repository the
 * installation can see, which is a repository path and therefore caller input:
 * a Hanzo caller published into `ghcr.io/luxfi`, and the pod mounted `push-luxfi`
 * to do it, because the row said Hanzo and the image said lux.
 */
async function readConfig(
	source: ConfigSource,
	repo: string,
	sha: string,
): Promise<PlatformConfig | null> {
	if (source.forge === "hanzo-git") {
		return fetchPlatformConfigFromHanzoGit(hanzoGitConfig(), repo, sha);
	}
	const { provider } = await resolveProvider(source.installationId);
	return fetchPlatformConfig(provider, repo, sha);
}

/** Build-target arch from a target key (`linux/amd64`, `web:linux/amd64`). */
function archOf(target: string): BuildArch {
	return target.split("/").pop() === "arm64" ? "arm64" : "amd64";
}

/**
 * Dispatch one queued build to the build muscle: launch its BuildKit Job and
 * transition the row to `running`, recording the Job name (the build-watcher
 * polls it) and a `buildkit:<jobName>` correlation id.
 *
 * What it builds it reads off the row: the repository and the commit already
 * settled for the whole call. A commit is what `hanzo.yml` was read at, what the
 * canonical-source check asked GitHub about, and what the tag spells — so it is
 * also what the pod checks out, and there is no second value for a caller to
 * hand down beside it.
 */
async function dispatchBuild(
	job: BuildJob,
	opts: {
		dockerfile?: string;
		context?: string;
		dockerTarget?: string;
		buildArgs?: Record<string, string>;
	},
): Promise<BuildJob> {
	const launch = await launchBuildJob({
		repo: job.repo,
		commit: job.sha,
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
	/**
	 * `owner/name` on the forge — the repository the build clones, whose owner
	 * names the runner pool and whose org owns the result.
	 */
	repo: string;
	/**
	 * The branch or tag to build, whole — `refs/heads/main`, `refs/tags/v1.2.3`.
	 *
	 * The commit follows from it, on the forge. A direct caller is a machine
	 * stating what it wants built, and what it wants built is a name; the object
	 * id that name currently resolves to is the forge's to say, and only the
	 * forge's, so there is no field here to say it in.
	 */
	ref: string;
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
	/**
	 * The org the CALLER acts as, checked against the org that owns the
	 * repository: a caller states which org it is, and stating one it is not is
	 * refused.
	 *
	 * Required, unlike {@link ScheduleInput}'s. There the forge authenticates the
	 * delivery and the principal follows from the installation binding, so there
	 * is nobody to ask. Here the credential authenticates a MACHINE and says
	 * nothing about which organization it is acting for, so the caller says it and
	 * the repository has to bear it out. A caller that need not state one is a
	 * caller that is never wrong.
	 */
	requireOrganizationId: string;
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
	// The repository the build clones and the ref it is about — settled, and
	// settled once, before a row exists to carry a value the build path would
	// then refuse.
	const repo = repoOf(input.repo);
	const ref = refOf(input.ref);
	// Where this build publishes, decided against the repository it reads, before
	// a row exists to carry a destination the muscle would mount a credential for.
	assertDestination(repo, input.image);
	// The org that owns the result is the org that owns the repository, which is
	// the same answer a forge delivery gets. `organizationId` on the row is what
	// later gates reading this build's logs, so it is resolved from the
	// repository and only confirmed against the caller.
	//
	// Asked before the forge is, because both answers are already here: a request
	// that cannot be built should not cost a round-trip to find out, and a repo
	// nobody owns should hear that rather than hear about a ref.
	const organizationId = await principal(repo);
	if (input.requireOrganizationId !== organizationId) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message:
				"Refusing to schedule a build for another organization — the build source resolves to an org you are not acting as",
		});
	}
	// The commit the ref names, and then the name this build publishes under —
	// which is a claim ABOUT that commit, so it cannot be judged before it.
	const sha = await commitOf(repo, ref);
	assertName(input.image, sha);
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

	// Is this commit on the canonical source? The same question the delivery lane
	// asks, asked here for the same reason and with the same answer: a forge repo
	// whose mirror row is gone serves its last state forever, and a build off it
	// is indistinguishable from a healthy one. The declaration lives in the repo,
	// so it is read from the repo, at the commit being built.
	await assertCanonical(repo, sha);

	// Keyed on the image too. Without it a second direct build of the same
	// commit to a DIFFERENT image returned the first job untouched, so the
	// caller was handed a success carrying an image it never asked for.
	const existing = await findBuildJobByTarget(repo, sha, target, input.image);
	if (existing) return existing;

	const job = await createBuildJob({
		repo,
		sha,
		ref,
		target,
		runnerPool: runnerPoolFor(ownerOf(repo), { os, arch }),
		image: input.image,
		organizationId,
		status: "queued",
		rolloutStatus: "skipped",
	});

	return dispatchBuild(job, {
		dockerfile: input.dockerfile,
		context: input.context,
		dockerTarget: input.dockerTarget,
		buildArgs: input.buildArgs,
	});
}

/**
 * Schedule all builds for a triggering commit. Idempotent on (repo, sha,
 * target): a re-delivery of the same webhook does not enqueue duplicates.
 *
 * The ONE call every front door makes, so every rule about whether a commit may
 * be built is settled here and holds at all of them: which organization the
 * build acts as, where it may publish, whether the commit is on the canonical
 * source, and whether hanzoai/ci already owns this repo's pipeline. A door adds
 * transport and an answer to render — never a rule of its own, and never a rule
 * it can skip.
 *
 * Returns {@link Declined} when the call schedules nothing.
 */
export async function scheduleBuilds(
	input: ScheduleInput,
): Promise<ScheduleResult | Declined> {
	// One repository, one ref, one commit: what the config is read from, what the
	// build clones, and what keys every row this call writes. Named before any of
	// that happens, and the commit is BOUND to the ref rather than stated beside
	// it — a caller that could name both could name a commit its ref never
	// carried, and every decision downstream reads the ref.
	const repo = repoOf(input.repo);
	const ref = refOf(input.ref);
	// The org that owns the result is the org that owns the repository — the same
	// answer on every lane and at every door, because it is what the row records,
	// what gates reading this build's logs, and what `promoteBuild` asks
	// `authorizeNamespace` about.
	const organizationId = await principal(repo);
	// A caller that STATED an org has to have the repository bear it out. Asked
	// BEFORE any build or deploy is scheduled against that org's namespaces.
	// Exact match, fail closed.
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
	const sha = await commitOf(repo, ref);
	const config = await readConfig(input.source, repo, sha);

	// ONE LANE. A push to the forge starts this scheduler AND the repo's
	// `.hanzo/workflows/cicd.yml`, which runs hanzoai/ci — the `test:` gate, the
	// structural refusals, `gover`, `publishable`. Both push the same image, so
	// where the caller exists ci owns the build and this yields. Asked here, in
	// the one call every door makes, and asked before a row, a Job or an image
	// can exist for a commit ci has not finished gating.
	//
	// A read of the forge, not of a delivery: what runs a repo's pipeline is a
	// fact about the repository the build clones, and the build clones from the
	// forge whichever door asked. So it takes `forgeReader` — address and read
	// token — and no webhook secret.
	const named = (config?.builds ?? []).flatMap(
		(b) => repoNaming(b.image) ?? [],
	);
	if (await ciOwnsBuild(forgeReader(), [repo, ...named])) {
		return {
			declined: "ci-owns",
			why:
				`hanzoai/ci builds ${repo} (${CI_CALLER_PATH}) — ` +
				"not scheduling a second, ungated build",
		};
	}

	// Two ways to declare no image: no `hanzo.yml` at all, or one that declares
	// none — a `test:`-only gate for hanzoai/ci, which is most of the estate.
	if (!config) {
		return { declined: "no-image", why: `${repo} declares no image to build` };
	}

	// Every image this config declares publishes into a namespace the repository's
	// own organization owns. Decided for the whole config before any of it is
	// enqueued: a delivery that names one destination it may not have is refused
	// entire, rather than half-built.
	for (const build of config.builds) assertDestination(repo, build.image);

	// The forge is what this path reads; GitHub is where the code was reviewed.
	// Nothing keeps those equal on its own — a repo whose mirror row is gone
	// serves its last state forever, and the build off it looks exactly like a
	// healthy one. So before enqueuing anything, confirm this commit is on the
	// canonical source. Refuse loudly if it is not; never repair it here.
	//
	// Asked whichever forge vouched for the delivery. `source` is how the config
	// was READ, and a rule that ran only for some ways of reading was a rule a
	// caller could choose not to be judged by. The declaration answers for the
	// GitHub lane too: a repo whose truth IS github.com passes on its own
	// reachability, in one call, rather than by not being asked.
	await assertCanonical(repo, sha, config);

	// Publishable `build_secrets:` → --build-args, fetched from KMS ONCE for the
	// whole config (the same value serves every image). The webhook lane never did
	// this — only the ci-reusable and the explicit /v1/runner buildArgs path — so a
	// platform-lane repo declaring one built with an EMPTY value and its Dockerfile
	// refused. Fail closed: fetchBuildSecrets throws if any declared name will not
	// resolve, stopping the whole delivery rather than baking an empty value.
	const declaredSecrets = [
		...new Set(config.builds.flatMap((b) => b.buildSecrets)),
	];
	const secretArgs = await fetchBuildSecrets(declaredSecrets, {
		path: config.kms?.path ?? "deploy",
		env: config.kms?.environment ?? "prod",
	});

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
			const existing = await findBuildJobByTarget(repo, sha, target);
			if (existing) {
				jobs.push(existing);
				continue;
			}
			const tag = resolveTag(build.tagPattern, { sha, ref });
			// A `{{git.tag}}` pattern has no image name on a branch push. Skip the
			// target rather than inventing one — the push still succeeds, and the
			// versioned image appears when the tag itself is pushed.
			if (tag === null) continue;
			const image = `${build.image}:${tag}`;
			// A pattern can also resolve to a name that names no one build — a
			// branch, on a lane whose pattern yields a version only on a tag push.
			// Skip that target for the same reason and in the same shape: the push
			// succeeds, and the image appears when the push names a version or the
			// commit. Said out loud, because a declaration that resolves to nothing
			// publishable is something its author wants to hear about.
			const naming = tagProblem(image, sha);
			if (naming) {
				console.info(`[build] ${naming}`);
				continue;
			}
			const job = await createBuildJob({
				repo,
				sha,
				ref,
				target,
				runnerPool: runnerPoolFor(ownerOf(repo), entry),
				image,
				organizationId,
				status: "queued",
				rolloutStatus: "skipped",
			});
			// Merge this image's fetched build_secrets over its declared args.
			// fetchBuildSecrets guaranteed each declared name resolved, so the
			// value is present; a name absent from secretArgs was never declared.
			const buildArgs: Record<string, string> = { ...build.buildArgs };
			for (const name of build.buildSecrets) {
				const value = secretArgs[name];
				if (value !== undefined) buildArgs[name] = value;
			}
			jobs.push(
				await dispatchBuild(job, {
					dockerfile: build.dockerfile,
					context: build.context,
					buildArgs,
				}),
			);
		}
	}

	return { organizationId, config, jobs };
}

/**
 * The repository a build reads, named once for the whole call.
 *
 * A build reads its config from a repository path and clones its code from a
 * repository path, and those are this one — so it is settled here, before a row
 * exists, rather than derived twice from a caller's spelling. `repoProblem` is
 * the same rule the direct front door answers 400 with; `repoName` is the name
 * the forge resolves, so one repository is one key on both front doors.
 */
function repoOf(repo: string): string {
	const problem = repoProblem(repo);
	if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
	return repoName(repo);
}

/**
 * The commit a build reads, named once for the whole call.
 *
 * Both front doors converge here, and only one of them gets its commit off a
 * signed delivery — the console's trigger takes a typed one. So the value is
 * read as a commit HERE, alongside the repository, rather than at each door:
 * it keys the row, names the target, addresses the config on the forge, spells
 * the image tag, and is the git context the build checks out, and it reaches
 * all five through this one call. `commitProblem` is the same rule the direct
 * front door answers 400 with; `commitName` is the one spelling, so one commit
 * is one key on both front doors.
 */
function shaOf(sha: string): string {
	const problem = commitProblem(sha);
	if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
	return commitName(sha);
}

/**
 * The branch or tag a build is about, named once for the whole call.
 *
 * Same shape as {@link repoOf} and {@link shaOf}: one rule, answered where the
 * value is first read, so both front doors refuse the same spellings.
 */
function refOf(ref: string): string {
	const problem = refProblem(ref);
	if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
	return ref;
}

/**
 * The commit a build reads: the one `ref` names on the forge.
 *
 * ONE way, at every door including the signed one. A delivery does carry the
 * commit its ref pointed at, and taking that instead would save a round-trip —
 * but a field a caller CAN fill is a field to be wrong about, and the whole
 * point here is that the two halves cannot be made to disagree. So there is no
 * such field, and the answer always comes from the same place.
 *
 * Nothing is lost to the push that lands while this one is being read: the row
 * is keyed by the commit it resolved, so the second delivery finds that row
 * rather than building it twice, and what the row says is what was built.
 *
 * A ref the forge does not resolve is not a build. That is the same refusal as
 * a repository nobody owns: there is nothing here to check out.
 */
async function commitOf(repo: string, ref: string): Promise<string> {
	const sha = await commitAt(forgeReader(), repo, ref);
	if (!sha) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Refusing to build ${repo}: "${ref}" names no commit there.`,
		});
	}
	return sha;
}

/**
 * This commit is on the source of truth, or this build does not happen.
 *
 * One call, both front doors. `declared` is the repo's own `source:` when the
 * caller has already read the config; the direct door has not, so it reads it
 * here — at the commit being built, from the repository being built, which is
 * the only place that declaration is meaningful.
 */
async function assertCanonical(
	repo: string,
	sha: string,
	config?: PlatformConfig | null,
): Promise<void> {
	// The CONFIG, not the declaration inside it — `source:` is legitimately
	// absent from most of them, and a caller passing that absence through as
	// "nothing given" would buy a second read of a file already in hand.
	const read =
		config === undefined
			? await fetchPlatformConfigFromHanzoGit(forgeReader(), repo, sha)
			: config;
	const why = await assertBuildableFromCanonicalSource({
		forgeRepo: repo,
		sha,
		declared: read?.source,
		facts: await readForgeRepoFacts(forgeReader(), repo),
		probe: githubReachability,
	});
	console.info(`[build] source check passed: ${why}`);
}

/**
 * The organization a build acts as: the one that owns the repository it reads.
 *
 * It is what the row records, what gates reading the build's logs, and what
 * `promoteBuild` asks `authorizeNamespace` about — so it is resolved from the
 * repository, never from the caller and never from the config the repository
 * itself ships. `authorizeNamespace` is keyed by namespace and VALUED by org, so
 * what it grants depends entirely on this being a different answer for different
 * organizations.
 *
 * An owner no organization here claims has no principal, and a build with no
 * principal does not start.
 */
async function principal(repo: string): Promise<string> {
	const owner = ownerOf(repo);
	const organizationId = await orgId(owner);
	if (!organizationId) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: `Refusing to build ${repo}: "${owner}" resolves to no organization here.`,
		});
	}
	return organizationId;
}

/**
 * The image this build publishes belongs to the organization that owns the
 * repository. Asked before a row exists, on both front doors, because the row
 * carries the image the build muscle then mounts a credential for.
 */
function assertDestination(repo: string, image: string): void {
	const problem = destinationProblem(repo, image);
	if (problem) throw new TRPCError({ code: "FORBIDDEN", message: problem });
}

/**
 * The name this build publishes under names one build.
 *
 * Refused here rather than skipped, because the direct door is a caller STATING
 * a destination: a caller that asked for a name we do not publish is told so. A
 * repository whose `tag-pattern` names none on a given push is a different
 * situation — nothing to build on this push — and the delivery lane skips that
 * target instead.
 */
function assertName(image: string, sha: string): void {
	const problem = tagProblem(image, sha);
	if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
}
