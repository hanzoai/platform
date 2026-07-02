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
 * `--output=type=image,…,push=true`. Git auth comes from `console-git-token`
 * (the `GIT_AUTH_TOKEN` env BuildKit reads for an authenticated git context),
 * registry auth from `kaniko-ghcr` mounted at `/root/.docker`, scheduled onto
 * the `runner-pool-32g` CI pool (tainted `dedicated=ci-runner`). Bridging the
 * scheduler to this is what makes platform-native builds REAL — no human
 * applying Job YAML by hand.
 */
import { TRPCError } from "@trpc/server";
import { getDefaultClients } from "../k8s/k8s-client";
import type { BuildArch } from "./platform-config";

/** BuildKit executor image — the canonical in-cluster builder (proven contract). */
const BUILDKIT_IMAGE = "moby/buildkit:v0.16.0";
/** Secret (key `token`) used to clone private repos via the git context. */
const GIT_SECRET = "console-git-token";
/** Secret (key `config.json`) holding the GHCR push credential, mounted at /root/.docker. */
const DOCKER_CONFIG_SECRET = "kaniko-ghcr";
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

const DEFAULT_RESOURCES: BuildResources = {
	requests: { cpu: "2", memory: "6Gi", "ephemeral-storage": "24Gi" },
	limits: { cpu: "8", memory: "16Gi", "ephemeral-storage": "60Gi" },
};

export interface BuildJobLaunchInput {
	/** `owner/name` — the source repository. */
	repo: string;
	/**
	 * Git context fragment BuildKit clones + checks out: a full ref
	 * (`refs/heads/main`, `refs/tags/v1.2.3`) or a SHA — the ref the triggering
	 * commit is the tip of. Builds track the ref tip; (repo, sha, target)
	 * idempotency dedupes re-triggers.
	 */
	gitRef: string;
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
	/** Namespace to launch in. Default `hanzo`. */
	namespace?: string;
	/** Override the resource envelope (large repos like platform need more). */
	resources?: BuildResources;
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
	/** Image digest, when an external builder reported one via /v1/build-callback. */
	digest?: string;
	/** Failure detail when `done && !succeeded`. */
	reason?: string;
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
 * `buildctl-daemonless.sh` args for a build — pure, so the unit test can assert
 * the contract. Mirrors the proven hand-applied BuildKit Jobs: dockerfile.v0
 * frontend, HTTPS git context, image output pushed to GHCR.
 */
export function buildkitArgs(input: BuildJobLaunchInput): string[] {
	const dockerfile = (input.dockerfile ?? "Dockerfile").replace(/^\.\//, "");
	const arch = input.arch ?? "amd64";
	const args = [
		"build",
		"--frontend=dockerfile.v0",
		`--opt=context=https://github.com/${input.repo}.git#${input.gitRef}`,
		`--opt=filename=${dockerfile}`,
		`--opt=platform=linux/${arch}`,
	];
	if (input.context && input.context !== ".") {
		args.push(`--opt=context-subdir=${input.context}`);
	}
	if (input.dockerTarget) args.push(`--opt=target=${input.dockerTarget}`);
	for (const [k, v] of Object.entries(input.buildArgs ?? {})) {
		args.push(`--opt=build-arg:${k}=${v}`);
	}
	args.push(
		"--secret=id=GIT_AUTH_TOKEN,env=GIT_AUTH_TOKEN",
		"--secret=id=gh_token,env=GH_TOKEN",
		// Materialized ~/.netrc (see buildBuildkitJob's command wrapper) so a
		// Dockerfile that clones private repos with `--mount=type=secret,id=netrc`
		// authenticates. Same credential (console-git-token) as the git context —
		// one credential, one way.
		"--secret=id=netrc,src=/tmp/netrc",
		`--output=type=image,name=${input.image},push=true`,
		"--progress=plain",
	);
	return args;
}

/** Build the BuildKit Job object — pure (no IO), so its shape is unit-testable. */
export function buildBuildkitJob(input: BuildJobLaunchInput) {
	const namespace = input.namespace ?? "hanzo";
	const arch = input.arch ?? "amd64";
	const name = buildJobName(input.repo, input.buildJobId);
	const resources = input.resources ?? DEFAULT_RESOURCES;
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
							// GIT_AUTH_TOKEN env, so Dockerfiles cloning private repos
							// via `--mount=type=secret,id=netrc` authenticate. `$0` is a
							// placeholder; buildctl's real args ride `"$@"`.
							command: ["/bin/sh", "-c"],
							args: [
								'printf "machine github.com login x-access-token password %s\\n" "$GIT_AUTH_TOKEN" > /tmp/netrc && exec buildctl-daemonless.sh "$@"',
								"buildctl-daemonless.sh",
								...buildkitArgs(input),
							],
							securityContext: { privileged: true },
							env: [
								{
									name: "GIT_AUTH_TOKEN",
									valueFrom: {
										secretKeyRef: { name: GIT_SECRET, key: "token" },
									},
								},
								{
									name: "GH_TOKEN",
									valueFrom: {
										secretKeyRef: { name: GIT_SECRET, key: "token" },
									},
								},
								{ name: "DOCKER_CONFIG", value: "/root/.docker" },
							],
							resources,
							volumeMounts: [
								{ mountPath: "/root/.docker", name: "docker-config" },
							],
						},
					],
					volumes: [
						{
							name: "docker-config",
							secret: {
								secretName: DOCKER_CONFIG_SECRET,
								items: [{ key: "config.json", path: "config.json" }],
							},
						},
					],
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
	const job = buildBuildkitJob(input);
	const namespace = input.namespace ?? "hanzo";
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
	return { jobName: job.metadata.name, namespace, image: input.image };
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
 * Read a build Job's terminal outcome. The image is its own evidence — the
 * pushed `ghcr.io/<repo>:<tag>` either exists or it doesn't; BuildKit does not
 * write a digest into the pod, so the in-cluster path leaves `digest` unset (an
 * external builder may supply one via /v1/build-callback).
 */
export async function readBuildOutcome(
	namespace: string,
	jobName: string,
): Promise<BuildOutcome> {
	const status = await readJobStatus(namespace, jobName);
	if (!status.done) return { done: false, succeeded: false };
	if (status.succeeded) return { done: true, succeeded: true };
	return {
		done: true,
		succeeded: false,
		reason: `BuildKit Job ${jobName} failed (backoff exhausted)`,
	};
}
