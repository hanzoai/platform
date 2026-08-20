/**
 * buildkit-job — the build muscle.
 *
 * Platform's ONE way to build a container image: an in-cluster BuildKit Job. The
 * BuildScheduler resolves what to build (image ref, dockerfile, context) and
 * this module launches the Job that clones the repo, builds the image, and
 * pushes it to GHCR — on our own runner pool, never via GitHub Actions.
 *
 * Decomplected exactly like `e2e-runner`: this module owns ONLY "shape + launch
 * the build Job" and "read its outcome"; BuildKit owns building; the
 * build-watcher owns advancing the buildJob row. It reuses the platform's batch
 * client — the same k8s seam that drives e2e Jobs and operator-CR deploys.
 *
 * The Job spec mirrors the PROVEN, hand-applied build Jobs that already build
 * commerce/chat/cloud on this cluster (`<repo>-build-<sha>`): a privileged
 * `moby/buildkit` pod running `buildctl-daemonless.sh build` with the
 * `dockerfile.v0` frontend over an HTTPS git context, pushing to
 * `--output=type=image,…,push=true`. Source comes from the forge over an
 * authenticated git context (`GIT_AUTH_TOKEN` from `forge-token`), registry auth
 * from the per-org `push-<org>` secret mounted at `/root/.docker`, scheduled onto
 * the `runner-pool-32g` CI pool (tainted `dedicated=ci-runner`). Bridging the
 * scheduler to this is what makes platform-native builds REAL — no human
 * applying Job YAML by hand.
 *
 * Dual-push (opt-in, `FLEET_REGISTRY_HOST`): with a fleet registry set, the ONE
 * build pushes the SAME image to both GHCR (public consumers pull it) and
 * `oci.hanzo.ai` (the S3-backed store the estate DEPLOYS from) — additive,
 * matching the `hanzoai/ci` reusable's dual-host pattern. Unset (the default)
 * keeps the exact single-GHCR proven behavior.
 */
import { TRPCError } from "@trpc/server";
import { commitProblem, forgeHost, forgeUrl, repoProblem } from "../hanzo-git";
import { getDefaultClients } from "../k8s/k8s-client";
import { destinationProblem, pushSecret, registryProblem } from "../org";
import { parseImageRef, withRegistryHost } from "./image-ref";
import type { BuildArch } from "./platform-config";

/** BuildKit executor image — the canonical in-cluster builder (proven contract). */
const BUILDKIT_IMAGE = "moby/buildkit:v0.16.0";
/**
 * Secret (key `token`) the build presents to the forge to read source, named
 * for the host it authenticates to. Reconciles from KMS `hanzo/deploy`
 * `FORGE_TOKEN`; the forge serves no repository anonymously, so the mount is
 * required and a missing credential stops the pod instead of reaching a clone.
 */
const FORGE_SECRET = "forge-token";
/**
 * Secret (key `token`) handed to a Dockerfile as the `gh_token` build secret,
 * for resolving Go modules whose PATH is a github.com path.
 *
 * A module path is part of a module's identity — `module github.com/hanzoai/o11y`
 * is what every dependent's `go.mod` names — so with `GOPRIVATE=github.com/hanzoai/*`
 * the toolchain takes a direct VCS fetch to github.com and needs a credential
 * valid THERE. Eleven Dockerfiles wire it through `git config url.…insteadOf`.
 *
 * Distinct from {@link FORGE_SECRET} in name because it is distinct in kind:
 * this one resolves DEPENDENCIES at github.com, that one reads the build's own
 * SOURCE from the forge. Two hosts, two credentials, and a shared name would let
 * either be swapped for the other without the swap looking wrong.
 */
const MODULE_FETCH_SECRET = "console-git-token";
/**
 * GHCR push credentials are PER NAMESPACE (`push-hanzoai` / `push-luxfi` /
 * `push-zooai`), named by `pushSecret` from the repository being built and the
 * image it publishes — never a single shared secret. A build mounts exactly one,
 * and only the one its own organization publishes under, so a token reachable
 * from a hanzo build cannot push to ghcr.io/luxfi.
 *
 * This replaced a hardcoded `kaniko-ghcr`, which existed only in the `hanzo`
 * namespace and so did not survive the move of builds into `hanzo-build` — the
 * pod would have failed to mount a secret that is not there.
 *
 * The push secrets store a dockerconfigjson under `.dockerconfigjson`, which is
 * projected to the `config.json` filename BuildKit reads.
 */
const PUSH_CRED_KEY = ".dockerconfigjson";
/**
 * KMS-synced docker cred (key `.dockerconfigjson`) for the fleet registry
 * (`oci.hanzo.ai`) — the SAME secret the `hanzoai/ci` reusable reads. Only
 * mounted (alongside the per-org push cred) when a fleet registry is configured;
 * the fleet cred is NEVER duplicated into a push secret, so `registry-credentials`
 * stays its one canonical home.
 */
const FLEET_CRED_SECRET = "registry-credentials";

/**
 * The fleet registry host every image is ALSO pushed to (on top of GHCR), or
 * undefined when unset. ONE config value — `FLEET_REGISTRY_HOST` (e.g.
 * `oci.hanzo.ai`) — carries the whole dual-push; there are no scattered
 * literals. Unset (the default) = GHCR-only, byte-identical to the proven build.
 *
 * A set value names a registry this fabric publishes to, judged by the same
 * `registryProblem` a destination on the row is judged by. Naming any other host
 * stops the build here, saying which host and which are real — rather than
 * aiming every build in the fleet at a name that answers nothing.
 */
export function fleetRegistryHost(): string | undefined {
	const host = process.env.FLEET_REGISTRY_HOST?.trim();
	if (!host) return undefined;
	const problem = registryProblem(host);
	if (problem) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: `FLEET_REGISTRY_HOST ${problem}`,
		});
	}
	return host;
}

/**
 * The namespace build Jobs run in. ONE seam — `PLATFORM_BUILD_NS` — with the
 * isolated build namespace as the default.
 *
 * It must NOT default to `hanzo`. `hanzo` is the APPLICATION namespace: it holds
 * every tenant Secret in the estate, and a build executes a Dockerfile we did not
 * write. `hanzo-build` exists precisely to keep those apart — it carries no
 * secrets, denies all ingress, and its egress policy blocks the internal cluster
 * ranges and the cloud-metadata IP (see hanzoai/universe
 * infra/k8s/hanzo-build/). Defaulting here to `hanzo` silently undid that
 * isolation for every platform-launched build, and it is also why the first
 * self-service enqueue was refused: the platform-app ServiceAccount is granted
 * job-create in `hanzo-build`, not in `hanzo`.
 */
export function buildNamespace(): string {
	const ns = process.env.PLATFORM_BUILD_NS?.trim();
	return ns ? ns : "hanzo-build";
}

/**
 * Materialize ~/.netrc from GIT_AUTH_TOKEN so a Dockerfile can clone private
 * repos. The machine line names the same host the git context fetches from, so
 * a Dockerfile's own clones reach the source the build was resolved against.
 */
const NETRC_SETUP = `printf "machine ${forgeHost()} login x-access-token password %s\\n" "$GIT_AUTH_TOKEN" > /tmp/netrc`;

/**
 * The `sh -c` wrapper the build container runs. Without a fleet registry it is
 * byte-identical to the proven Job (netrc → exec buildctl). With one, it also
 * merges the two mounted docker creds — `push-<org>` (GHCR) and
 * `registry-credentials` (fleet) — into the writable `DOCKER_CONFIG` before
 * exec, because k8s cannot merge two secrets into one file and BuildKit reads a
 * single `config.json`. The merge is jq-free (the builder image is busybox): both
 * secrets are compact `{"auths":{…}}` objects, so each is peeled to its lone
 * `.auths` entry and recombined. A missing/empty fleet cred degrades to
 * GHCR-only, so a fleet-registry hiccup never fails the primary push.
 */
export function buildkitWrapperScript(fleetHost?: string): string {
	if (!fleetHost) return `${NETRC_SETUP} && exec buildctl-daemonless.sh "$@"`;
	const merge =
		"g=$(sed -e 's/^{\"auths\":{//' -e 's/}}$//' /tmp/ghcr-cred/config.json); " +
		"f=$(sed -e 's/^{\"auths\":{//' -e 's/}}$//' /tmp/fleet-cred/config.json 2>/dev/null || true); " +
		'if [ -n "$f" ]; then printf \'{"auths":{%s,%s}}\' "$g" "$f" > /root/.docker/config.json; ' +
		"else cp /tmp/ghcr-cred/config.json /root/.docker/config.json; fi";
	return `${NETRC_SETUP} && ${merge} && exec buildctl-daemonless.sh "$@"`;
}
/** CI runner taint the build Jobs tolerate. */
const CI_TOLERATION = {
	effect: "NoSchedule",
	key: "dedicated",
	operator: "Equal",
	value: "ci-runner",
} as const;

/** Node pool an arch builds on. arm64 has no pool yet → such a Job pends visibly (never a silent mis-build). */
const ARCH_NODE_POOL: Record<BuildArch, string> = {
	amd64: "runner-pool-32g",
	arm64: "runner-pool-arm64",
};

/** Build Job resource envelope. Defaults suit a typical service image build. */
export interface BuildResources {
	requests: { cpu: string; memory: string; "ephemeral-storage": string };
	limits: { cpu: string; memory: string; "ephemeral-storage": string };
}

// ephemeral-storage is requested and limited at the SAME value, unlike cpu/memory.
//
// The scheduler packs by REQUEST, but the node evicts by ACTUAL USE — and an
// ephemeral-storage eviction does not fall on the greedy pod, it falls on
// whichever pod the kubelet picks. With request 24Gi / limit 60Gi on an 88Gi
// node, three builds schedule (3 x 24 = 72Gi, inside the ~73Gi usable after the
// ~15Gi eviction threshold) and any ONE of them may then grow to 60Gi and take
// the other two down with it. Measured after the layer cache landed: build-docs
// and pf-runner were both Evicted for "node was low on resource:
// ephemeral-storage", and four commerce builds could not schedule at all
// ("6 Insufficient ephemeral-storage") — none of them the build that overran.
//
// Making the two equal is what confines the blast radius to the offender: a
// build that exceeds its own limit is killed on its own, its neighbours keep
// running, and the number the scheduler reasons about is the number the node
// actually experiences. Guaranteed-QoS for the one resource whose overrun is
// externalized onto other pods.
//
// The registry layer cache (see buildkitArgs) is what made this binding: mode=max
// retains every intermediate stage's layers rather than only the final stage's,
// which is exactly why it is worth having — a cold docs build took 21m07s — and
// also why per-build disk went up. The cache is correct; the envelope had to
// stop lying about it. Raise this only alongside the node pool's allocatable,
// never past (allocatable - eviction threshold) / concurrent-builds.
const DEFAULT_RESOURCES: BuildResources = {
	requests: { cpu: "2", memory: "6Gi", "ephemeral-storage": "24Gi" },
	limits: { cpu: "8", memory: "16Gi", "ephemeral-storage": "24Gi" },
};

export interface BuildJobLaunchInput {
	/** `owner/name` — the source repository, as {@link repoProblem} defines one. */
	repo: string;
	/**
	 * The commit BuildKit checks out, as {@link commitProblem} defines one — the
	 * object id on the buildJob row, which is also what the build's `hanzo.yml`
	 * was read at and what its tag spells.
	 *
	 * An object id and not a branch, because a branch is a name for whatever it
	 * points at when the pod fetches, and the pod fetches after everything about
	 * the build was decided. One commit, decided once, compiled.
	 */
	commit: string;
	/** Fully-resolved destination image, e.g. `ghcr.io/hanzoai/pricing:<tag>`. */
	image: string;
	/** Dockerfile path relative to the context. Default `Dockerfile`. */
	dockerfile?: string;
	/** Build context sub-path within the repo. Default `.` (repo root). */
	context?: string;
	/** Optional Docker build stage (`--opt=target=`) for multi-stage Dockerfiles. */
	dockerTarget?: string;
	/** Optional `--opt=build-arg:KEY=VAL` pairs (e.g. `{ VERSION: "1.2.3" }`). */
	buildArgs?: Record<string, string>;
	/** Target architecture. Drives node pool + image platform. Default amd64. */
	arch?: BuildArch;
	/** Stable correlation id (the buildJob id) baked into the Job name + labels. */
	buildJobId: string;
	/** Namespace to launch in. Default `buildNamespace()` (`hanzo-build`). */
	namespace?: string;
	/** Override the resource envelope (large repos like platform need more). */
	resources?: BuildResources;
	/**
	 * Fleet registry host to ALSO push the built image to, e.g.
	 * `oci.hanzo.ai`. When set, the one BuildKit output carries both refs
	 * (GHCR + the fleet host, host-swapped from `image`) and the pod mounts the
	 * fleet cred. Defaulted from `fleetRegistryHost()` at the launch boundary;
	 * leave unset in callers. Empty/undefined = GHCR-only (the proven path).
	 */
	fleetRegistryHost?: string;
}

export interface BuildJobLaunch {
	jobName: string;
	namespace: string;
	image: string;
}

/** Outcome of a launched build Job, read from the cluster by the watcher. */
export interface BuildOutcome {
	/** The Job has reached a terminal state (succeeded or failed). */
	done: boolean;
	succeeded: boolean;
	/** Image digest (`sha256:…`) of the manifest this build pushed. */
	digest?: string;
	/** Failure detail when `done && !succeeded`. */
	reason?: string;
	/** Tail of the failed pod's build log, for the `logs` column. */
	log?: string;
}

/** RFC1123-safe lowercase segment (k8s names): [a-z0-9-], no leading/trailing dash. */
function dnsSafe(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

/**
 * Deterministic, RFC1123-compliant build Job name: `build-<repo>-<id>`, capped
 * at 63 chars. Deterministic on `buildJobId` so a re-launch of the same row
 * collides (create returns 409) instead of spawning a duplicate build.
 */
export function buildJobName(repo: string, buildJobId: string): string {
	const name = dnsSafe(repo.split("/")[1] ?? repo);
	const id = dnsSafe(buildJobId).slice(0, 12);
	return `build-${name}-${id}`.slice(0, 63).replace(/-$/, "");
}

/**
 * The version an image ref names — its tag, or "" when it names none.
 *
 * The digest is peeled first: `…@sha256:<hex>` names bytes, not a release, and a
 * ref may pin both (`:v1.2.3@sha256:…`), where the version is the tag. Parsing
 * itself stays in `parseImageRef` — one implementation, per that module's rule.
 */
export function imageVersion(ref: string): string {
	const at = ref.indexOf("@");
	return parseImageRef(at === -1 ? ref : ref.slice(0, at))[1];
}

/**
 * Every image reference this build publishes: the destination on the row, and —
 * when a fleet registry is configured — the same reference on that host, so one
 * build reaches both with no rebuild.
 *
 * ONE list, written by `buildkitArgs` into the exporter and judged by
 * `buildBuildkitJob` before a credential is mounted. Deriving it twice is how a
 * build ends up pushing somewhere nothing judged.
 */
function destinations(input: BuildJobLaunchInput): string[] {
	return input.fleetRegistryHost
		? [input.image, withRegistryHost(input.image, input.fleetRegistryHost)]
		: [input.image];
}

/**
 * `buildctl-daemonless.sh` args for a build — pure, so the unit test can assert
 * the contract. Mirrors the proven hand-applied BuildKit Jobs: dockerfile.v0
 * frontend, HTTPS git context, image output pushed to GHCR. When a fleet
 * registry is set, the single image output carries BOTH refs (GHCR +
 * fleet-host), so one build pushes to both destinations with no rebuild.
 */
export function buildkitArgs(input: BuildJobLaunchInput): string[] {
	// The context addresses one commit of one repository under the forge, so both
	// halves are read as what they are before either is spliced into it. Every
	// build passes here, whichever front door asked. A fragment is where BuildKit
	// cuts a subdirectory off a ref (`#ref:subdir`), so a value that is an object
	// id is a value that names the commit and nothing beside it.
	const source = repoProblem(input.repo) ?? commitProblem(input.commit);
	if (source) {
		throw new TRPCError({ code: "BAD_REQUEST", message: source });
	}
	const dockerfile = (input.dockerfile ?? "Dockerfile").replace(/^\.\//, "");
	const arch = input.arch ?? "amd64";
	const args = [
		"build",
		"--frontend=dockerfile.v0",
		`--opt=context=${forgeUrl()}/${input.repo}.git#${input.commit}`,
		`--opt=filename=${dockerfile}`,
		`--opt=platform=linux/${arch}`,
	];
	if (input.context && input.context !== ".") {
		args.push(`--opt=context-subdir=${input.context}`);
	}
	if (input.dockerTarget) args.push(`--opt=target=${input.dockerTarget}`);
	// Keep the .git directory in the build context. NOT cosmetic, and the single
	// most expensive omission this builder can make: BuildKit's git context
	// exports a WORKTREE with no .git by default, so any Dockerfile that derives
	// its version from the repo (`git describe --tags`, the near-universal Go
	// pattern — luxfi/node's scripts/git_commit.sh is the case that burned us)
	// silently fails the describe and falls through to a checked-in version file
	// that is usually stale. The image is then TAGGED with the right version
	// while the BINARY self-reports an old one, so an operator verifying a
	// rollout reads a downgrade and concludes the deploy failed. Proven: a
	// luxfi/node Job without this printed "Building Lux Node v1.32.11" while
	// building the v1.36.33 tag.
	//
	// It is a DEFAULT, not a hard-code: it is emitted only when the caller did
	// not state the key itself, so an explicit buildArgs entry is the one that
	// ships. That is an explicit precedence rather than a bet on which duplicate
	// `--opt` BuildKit keeps. Harmless for repos that ignore it (they just carry
	// a .git they never read).
	const buildArgs = input.buildArgs ?? {};
	if (!("BUILDKIT_CONTEXT_KEEP_GIT_DIR" in buildArgs)) {
		args.push("--opt=build-arg:BUILDKIT_CONTEXT_KEEP_GIT_DIR=1");
	}
	// A build already knows the version it is building: the destination tag IS
	// it. Passing it as VERSION is what lets the binary inside name its own
	// lineage — the near-universal `ARG VERSION` + `-ldflags -X main.version`
	// pattern. Measured: `ghcr.io/hanzoai/iam:v1.34.1` built through /v1/runner
	// answered `iam dev` from `/iam version`, because the Dockerfile's
	// `ARG VERSION=dev` default was never overridden, so an operator holding a
	// running pod could not tell which release it was. The forge workflow passed
	// `--build-arg VERSION=<tag>` and platform did not, so the same commit built
	// through two front doors produced two different self-reports.
	//
	// Derived, not asked for: a caller cannot forget it, and it cannot disagree
	// with the tag it ships under — the two identifiers are one string. Same
	// default-not-hard-code precedence as KEEP_GIT_DIR above; a digest-pinned
	// destination names no version, so nothing is invented for it.
	if (!("VERSION" in buildArgs)) {
		const version = imageVersion(input.image);
		if (version) args.push(`--opt=build-arg:VERSION=${version}`);
	}
	for (const [k, v] of Object.entries(buildArgs)) {
		args.push(`--opt=build-arg:${k}=${v}`);
	}
	// BuildKit's image exporter is a comma-separated list of fields, and its
	// `name` is itself a comma-separated list of refs — so the field is quoted
	// and the CSV parser reads the whole ref list as one value. ONE spelling for
	// one ref or two: what varies is how many destinations there are, not how a
	// destination is written.
	const push = `--output=type=image,"name=${destinations(input).join(",")}",push=true`;
	// Layer cache, and the reason a build takes minutes instead of seconds.
	//
	// Every build runs `buildctl-daemonless.sh` in a FRESH one-shot Job pod: the
	// buildkitd it starts keeps its snapshot store on the pod filesystem, which is
	// destroyed when the Job ends, and the namespace has no PVC. So with no cache
	// flags EVERY build was 100% cold — re-pulling every base layer and re-running
	// `pnpm install` / `go mod download` from scratch each time. Measured on the
	// live fleet: docs 19-21 min, console 2-3 min, for repos whose lockfiles had
	// not moved. The dependency install was being redone on every single push.
	//
	// A registry-backed cache is the only store that outlives the pod, so it is
	// the one that can help here. `mode=max` is what makes it worth having: the
	// default `min` exports only the FINAL stage's layers, and every Dockerfile we
	// build is multi-stage with a slim runtime stage — so `min` would cache
	// precisely the cheap half and none of the install that costs the 19 minutes.
	//
	// `ignore-error=true` on the export: a cache push is an optimization and must
	// never be able to fail a build that otherwise succeeded (a missing scope on
	// the push credential would otherwise turn a green build red).
	//
	// The ref is derived from the destination image, so it needs no new
	// configuration and cannot drift from what it caches — same repository, a
	// dedicated `buildcache-<arch>` tag, kept per-arch because a cross-arch import
	// is a guaranteed miss. Digest-pinned destinations name no repository we can
	// safely append to, hence the guard.
	const [cacheRepo] = parseImageRef(input.image);
	if (cacheRepo) {
		const cacheRef = `${cacheRepo}:buildcache-${arch}`;
		args.push(
			`--import-cache=type=registry,ref=${cacheRef}`,
			`--export-cache=type=registry,ref=${cacheRef},mode=max,ignore-error=true`,
		);
	}
	args.push(
		"--secret=id=GIT_AUTH_TOKEN,env=GIT_AUTH_TOKEN",
		"--secret=id=gh_token,env=GH_TOKEN",
		// Materialized ~/.netrc (see buildBuildkitJob's command wrapper) so a
		// Dockerfile that clones private repos with `--mount=type=secret,id=netrc`
		// authenticates. Same credential as the git context — one credential,
		// one way.
		"--secret=id=netrc,src=/tmp/netrc",
		push,
		"--progress=plain",
	);
	return args;
}

/**
 * Docker-registry auth wiring for the build pod — pure, so its shape is
 * unit-testable. Two shapes, selected by whether a fleet registry is set:
 *
 *  - none: a single-secret mount — the caller's `pushSecret` (`push-<org>`,
 *    projected to `config.json`) at `/root/.docker` (the `DOCKER_CONFIG` dir).
 *    Same shape as the proven hand-applied Job, which mounted the shared
 *    `kaniko-ghcr` here; only WHICH secret is mounted changed.
 *  - fleet: dual-push needs BOTH the GHCR cred and the fleet cred in ONE docker
 *    config, so both secrets mount read-only and `DOCKER_CONFIG` is a writable
 *    `emptyDir` the wrapper composes into (see `buildkitWrapperScript`).
 */
function dockerAuthWiring(
	pushSecret: string,
	fleetHost?: string,
): {
	volumeMounts: Array<{ mountPath: string; name: string; readOnly?: boolean }>;
	volumes: Array<Record<string, unknown>>;
} {
	const ghcrCred = {
		secretName: pushSecret,
		items: [{ key: PUSH_CRED_KEY, path: "config.json" }],
	};
	if (!fleetHost) {
		return {
			volumeMounts: [{ mountPath: "/root/.docker", name: "docker-config" }],
			volumes: [{ name: "docker-config", secret: ghcrCred }],
		};
	}
	return {
		volumeMounts: [
			{ mountPath: "/root/.docker", name: "docker-config" },
			{ mountPath: "/tmp/ghcr-cred", name: "ghcr-cred", readOnly: true },
			{ mountPath: "/tmp/fleet-cred", name: "fleet-cred", readOnly: true },
		],
		volumes: [
			{ name: "docker-config", emptyDir: {} },
			{ name: "ghcr-cred", secret: ghcrCred },
			{
				name: "fleet-cred",
				secret: {
					secretName: FLEET_CRED_SECRET,
					items: [{ key: ".dockerconfigjson", path: "config.json" }],
				},
			},
		],
	};
}

/** Build the BuildKit Job object — pure (no IO), so its shape is unit-testable. */
export function buildBuildkitJob(input: BuildJobLaunchInput) {
	// FIRST, because everything below reads the path apart: the Job's name, the
	// owner the destination is judged against, and the git context BuildKit
	// clones. `buildkitArgs` asks the same question further down, and asking it
	// here too is what lets those readers take an `owner/name` for granted
	// instead of each deciding what a half of one means.
	const source = repoProblem(input.repo);
	if (source) throw new TRPCError({ code: "BAD_REQUEST", message: source });

	const namespace = input.namespace ?? buildNamespace();
	const arch = input.arch ?? "amd64";
	const name = buildJobName(input.repo, input.buildJobId);
	const resources = input.resources ?? DEFAULT_RESOURCES;
	// The last place before a token reaches a build. Both front doors decide the
	// same thing before writing a row; deciding it again here is what makes the
	// row's image, rather than the row's existence, what the credential follows
	// from. EVERY reference this build will publish, not just the row's — a
	// second destination the exporter writes is a destination, and one nothing
	// judged is one anything could be.
	for (const destination of destinations(input)) {
		const problem = destinationProblem(input.repo, destination);
		if (problem) throw new TRPCError({ code: "FORBIDDEN", message: problem });
	}
	// Refuse rather than fall back: with no derivable namespace there is no
	// correct credential to mount, and guessing one is how a build ends up
	// pushing with another org's token. A caller sees this immediately; a silent
	// default would surface much later as a cross-org push.
	const secret = pushSecret(input.repo, input.image);
	if (!secret) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot derive a push credential from image "${input.image}": expected <registry>/<namespace>/<name>:<tag>`,
		});
	}
	const auth = dockerAuthWiring(secret, input.fleetRegistryHost);
	const labels = {
		"app.kubernetes.io/name": "build",
		"app.kubernetes.io/managed-by": "platform",
		"triggered-by": "platform.hanzo.ai",
		"hanzo.ai/build-job-id": dnsSafe(input.buildJobId).slice(0, 63),
	};

	return {
		apiVersion: "batch/v1",
		kind: "Job",
		metadata: { name, namespace, labels },
		spec: {
			activeDeadlineSeconds: 3600,
			backoffLimit: 1,
			ttlSecondsAfterFinished: 86400,
			template: {
				metadata: { labels },
				spec: {
					automountServiceAccountToken: false,
					restartPolicy: "Never",
					nodeSelector: {
						"doks.digitalocean.com/node-pool": ARCH_NODE_POOL[arch],
					},
					tolerations: [CI_TOLERATION],
					containers: [
						{
							name: "build",
							image: BUILDKIT_IMAGE,
							// Wrap buildctl to first materialize ~/.netrc from the
							// GIT_AUTH_TOKEN env (and, for a fleet registry, compose the
							// docker creds), so Dockerfiles cloning private repos via
							// `--mount=type=secret,id=netrc` authenticate. `$0` is a
							// placeholder; buildctl's real args ride `"$@"`.
							command: ["/bin/sh", "-c"],
							args: [
								buildkitWrapperScript(input.fleetRegistryHost),
								"buildctl-daemonless.sh",
								...buildkitArgs(input),
							],
							securityContext: { privileged: true },
							env: [
								{
									name: "GIT_AUTH_TOKEN",
									valueFrom: {
										secretKeyRef: { name: FORGE_SECRET, key: "token" },
									},
								},
								{
									name: "GH_TOKEN",
									valueFrom: {
										secretKeyRef: {
											name: MODULE_FETCH_SECRET,
											key: "token",
											optional: true,
										},
									},
								},
								{ name: "DOCKER_CONFIG", value: "/root/.docker" },
							],
							resources,
							volumeMounts: auth.volumeMounts,
						},
					],
					volumes: auth.volumes,
				},
			},
		},
	};
}

/**
 * Launch the build Job in-cluster. Returns its name; the build-watcher polls
 * `readBuildOutcome` to advance the buildJob row. Idempotent by name: a second
 * launch of the same buildJob hits a 409 AlreadyExists, surfaced as CONFLICT.
 */
export async function launchBuildJob(
	input: BuildJobLaunchInput,
): Promise<BuildJobLaunch> {
	// The ONE place the fleet-registry env is read: default it here so every
	// dispatch path (webhook + direct) opts into dual-push without threading it,
	// while `buildkitArgs`/`buildBuildkitJob` stay pure (fed via the input).
	const resolved: BuildJobLaunchInput = {
		...input,
		fleetRegistryHost: input.fleetRegistryHost ?? fleetRegistryHost(),
	};
	const job = buildBuildkitJob(resolved);
	const namespace = resolved.namespace ?? buildNamespace();
	const clients = getDefaultClients();
	try {
		await clients.batch.createNamespacedJob({ namespace, body: job as never });
	} catch (err) {
		const e = err as {
			code?: number;
			statusCode?: number;
			body?: { message?: string; reason?: string };
			message?: string;
		};
		const status = e.code ?? e.statusCode;
		if (status === 409 || e.body?.reason === "AlreadyExists") {
			throw new TRPCError({
				code: "CONFLICT",
				message: `Build Job ${job.metadata.name} already exists in ${namespace}`,
			});
		}
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: `Failed to launch build Job in ${namespace}: ${e.body?.message ?? e.message ?? String(err)}`,
		});
	}
	return { jobName: job.metadata.name, namespace, image: resolved.image };
}

/**
 * Generic terminal-status read for any platform-launched Job (build, e2e,
 * publish). `done=false` while it runs OR when the Job is missing (TTL-reaped /
 * not yet visible) — a vanished Job reads as non-terminal so a reconcile leaves
 * the row alone rather than guessing. Never throws.
 */
export async function readJobStatus(
	namespace: string,
	jobName: string,
): Promise<{ done: boolean; succeeded: boolean }> {
	const clients = getDefaultClients();
	try {
		const job = await clients.batch.readNamespacedJob({
			name: jobName,
			namespace,
		});
		const succeeded = job.status?.succeeded ?? 0;
		const failed = job.status?.failed ?? 0;
		if (succeeded > 0) return { done: true, succeeded: true };
		if (failed > 0) return { done: true, succeeded: false };
		return { done: false, succeeded: false };
	} catch {
		return { done: false, succeeded: false };
	}
}

/**
 * Digest of the manifest a `--progress=plain` BuildKit run pushed, read from its
 * log. Undefined when the log shows no push (nothing was published) or is gone.
 *
 * Anchored on the two lines that name a MANIFEST:
 *   #N pushing manifest for ghcr.io/hanzoai/app:v1.2.3@sha256:<64hex>
 *   #N exporting manifest sha256:<64hex>          (also "manifest list", multi-arch)
 *
 * Never on a bare `sha256:` — every layer line carries one — and never on
 * `exporting config sha256:…`, which is the CONFIG digest and is a different
 * value from the manifest digest that `<ref>@sha256:…` resolves. Pulling the
 * config digest here would be worse than NULL: a confident wrong answer that
 * drift detection would compare against and always flag.
 *
 * `pushing manifest for` wins over `exporting manifest` because it is proof the
 * bytes reached the registry, not just that they were assembled. With dual-push
 * (FLEET_REGISTRY_HOST) the SAME manifest goes to two hosts, so there are two
 * such lines carrying one digest; last wins and they agree.
 */
export function parseImageDigest(log: string): string | undefined {
	const pushed = [
		...log.matchAll(/pushing manifest for \S*?@(sha256:[0-9a-f]{64})/g),
	];
	const lastPushed = pushed.at(-1)?.[1];
	if (lastPushed) return lastPushed;
	const exported = [
		...log.matchAll(/exporting manifest(?: list)? (sha256:[0-9a-f]{64})/g),
	];
	return exported.at(-1)?.[1];
}

/**
 * Tail of a build Job's pod log. Bounded: the export/push vertices are the last
 * thing BuildKit prints, so the digest is always in the tail, and a big build's
 * plain log is far too large to pull whole every 15s watcher tick.
 */
const DIGEST_LOG_TAIL = 400;

/**
 * Read the build container's log. Never throws — a missing pod (TTL-reaped) or a
 * denied read degrades to `undefined`, i.e. exactly today's behaviour, rather
 * than failing a build that actually succeeded.
 */
async function readBuildLog(
	namespace: string,
	jobName: string,
): Promise<string | undefined> {
	const clients = getDefaultClients();
	try {
		// `job-name` is set by the Job controller, so this needs nothing from our
		// own label block. backoffLimit:1 means a retried build leaves a failed
		// sibling behind — the succeeded pod is the one that pushed.
		const pods = await clients.core.listNamespacedPod({
			namespace,
			labelSelector: `job-name=${jobName}`,
		});
		const items = pods.items ?? [];
		const pod =
			items.find((p) => p.status?.phase === "Succeeded") ??
			items[items.length - 1];
		const name = pod?.metadata?.name;
		if (!name) return undefined;
		return await clients.core.readNamespacedPodLog({
			name,
			namespace,
			container: "build",
			tailLines: DIGEST_LOG_TAIL,
		});
	} catch {
		return undefined;
	}
}

/**
 * Read a build Job's terminal outcome, INCLUDING which bytes it produced.
 *
 * A build that cannot name its own output makes the build row unusable as a
 * system of record: verifying a deploy then means reading Job logs and GHCR by
 * hand. It matters more than it sounds, because universe values pin both `tag:`
 * and `digest:` and the kubelet honours the DIGEST — bump the tag alone and it
 * renders `newtag@olddigest` and serves old bytes under a new SHA. Persisting
 * the digest here is what lets that be checked automatically.
 *
 * The digest is best-effort: it is read from the log, so an unreadable log
 * leaves it unset and the build still completes. It is never guessed.
 */
export async function readBuildOutcome(
	namespace: string,
	jobName: string,
): Promise<BuildOutcome> {
	const status = await readJobStatus(namespace, jobName);
	if (!status.done) return { done: false, succeeded: false };
	if (status.succeeded) {
		const log = await readBuildLog(namespace, jobName);
		return {
			done: true,
			succeeded: true,
			digest: log ? parseImageDigest(log) : undefined,
		};
	}
	// Read the log on the failure path too. `readBuildLog` already falls through
	// to the last pod when none succeeded, so this needs nothing new from k8s.
	// Without it every failure recorded the same sentence and nothing else:
	// 436 failed builds in the estate, ZERO with logs captured, so no build
	// failure was diagnosable once its pod was garbage-collected. The one real
	// cause (an UNRESOLVED_IMPORT that pinned an app two tags behind for days)
	// had to be recovered by re-running the build to catch a live pod.
	const log = await readBuildLog(namespace, jobName);
	const detail = log ? parseBuildFailure(log) : undefined;
	return {
		done: true,
		succeeded: false,
		reason: detail
			? `BuildKit Job ${jobName} failed: ${detail}`
			: `BuildKit Job ${jobName} failed (backoff exhausted)`,
		log: log ? log.slice(-LOG_TAIL_CHARS) : undefined,
	};
}

/** Bound what a single failure can write into the `logs` column. */
const LOG_TAIL_CHARS = 8000;

/**
 * Pull the actionable line out of a BuildKit log.
 *
 * BuildKit prints the real cause well before the trailing stack, e.g.
 *   [UNRESOLVED_IMPORT] Error: Could not resolve './LxGeneric' in …
 *   ERROR: process "/bin/sh -c … pnpm build" did not complete successfully
 * and then `error: failed to solve: …`. The last line alone is the least
 * useful of the three, so prefer the first genuine error and fall back to the
 * tail only when nothing matches.
 */
export function parseBuildFailure(log: string): string | undefined {
	const lines = log
		.split("\n")
		.map((l) => l.replace(/^#\d+\s+[\d.]+\s*/, "").trim())
		.filter(Boolean);

	const signal =
		lines.find((l) => /^\[[A-Z_]+\]\s*Error:/.test(l)) ??
		lines.find((l) => /^ERROR:/.test(l)) ??
		lines.find((l) => /did not complete successfully/.test(l)) ??
		lines.find((l) => /^error: failed to solve/.test(l)) ??
		// Last resort: the final line that reads like a failure. Matching only
		// /error/i misses the ones that matter most in practice — "permission
		// denied", "no space left on device", "cannot find module".
		lines
			.filter((l) => /error|failed|denied|cannot|not found|no space/i.test(l))
			.pop();

	return signal?.slice(0, 400);
}
