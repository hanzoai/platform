/**
 * kaniko-job — the build muscle.
 *
 * Platform's ONE way to build a container image: an in-cluster Kaniko Job. The
 * BuildScheduler resolves what to build (image ref, dockerfile, context) and
 * this module launches the Job that clones the repo, builds the image, and
 * pushes it to GHCR — on our own runner pool, never via GitHub Actions.
 *
 * Decomplected exactly like `e2e-runner`: this module owns ONLY "shape + launch
 * the build Job" and "read its outcome"; Kaniko owns building; the build-watcher
 * owns advancing the buildJob row. It reuses the platform's batch client — the
 * same k8s seam that drives e2e Jobs and operator-CR deploys.
 *
 * The Job spec mirrors the proven, hand-applied build Jobs (e.g. the
 * `platform-build-*` / `<repo>-build-*` Jobs): Kaniko executor, a git context
 * `git://github.com/<repo>.git#<ref>`, push to `--destination`, the image digest
 * written to /dev/termination-log via `--digest-file`, git auth from
 * `console-git-token`, registry auth from `kaniko-ghcr`, scheduled onto the
 * `dedicated=ci-runner` pool. Bridging the scheduler to this is what makes
 * platform-native builds REAL — no human applying Job YAML by hand.
 */
import { TRPCError } from "@trpc/server";
import { getDefaultClients } from "../k8s/k8s-client";
import type { BuildArch } from "./platform-config";

/** Kaniko executor image — the canonical in-cluster builder. */
const KANIKO_IMAGE = "gcr.io/kaniko-project/executor:latest";
/** Secret (key `token`) used to clone private repos. */
const GIT_SECRET = "console-git-token";
/** Secret (key `config.json`) holding the GHCR push credential, mounted at /kaniko/.docker. */
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
	requests: { cpu: "2", memory: "8Gi", "ephemeral-storage": "24Gi" },
	limits: { cpu: "6", memory: "14Gi", "ephemeral-storage": "60Gi" },
};

export interface BuildJobLaunchInput {
	/** `owner/name` — the source repository. */
	repo: string;
	/**
	 * Git context fragment Kaniko clones + checks out: a full ref
	 * (`refs/heads/main`, `refs/tags/v1.2.3`) — the ref the triggering SHA is
	 * the tip of. Builds track the ref tip; (repo, sha, target) idempotency
	 * dedupes re-triggers.
	 */
	gitRef: string;
	/** Fully-resolved destination image, e.g. `ghcr.io/hanzoai/pricing:<tag>`. */
	image: string;
	/** Dockerfile path relative to the context. Default `Dockerfile`. */
	dockerfile?: string;
	/** Build context sub-path within the repo. Default `.` (repo root). */
	context?: string;
	/** Optional Docker build stage (`--target`) for multi-stage Dockerfiles. */
	dockerTarget?: string;
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
	/** Image digest from /dev/termination-log, when the build wrote one. */
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

/** Kaniko args for a build — pure, so the integration test can assert the contract. */
export function kanikoArgs(input: BuildJobLaunchInput): string[] {
	const dockerfile = (input.dockerfile ?? "Dockerfile").replace(/^\.\//, "");
	const context = input.context ?? ".";
	const arch = input.arch ?? "amd64";
	const args = [
		`--context=git://github.com/${input.repo}.git#${input.gitRef}`,
		`--dockerfile=${dockerfile}`,
		`--destination=${input.image}`,
		`--custom-platform=linux/${arch}`,
		"--cache=false",
		"--single-snapshot",
		"--cleanup",
		"--verbosity=info",
		"--digest-file=/dev/termination-log",
	];
	if (context !== ".") args.splice(2, 0, `--context-sub-path=${context}`);
	if (input.dockerTarget) args.splice(2, 0, `--target=${input.dockerTarget}`);
	return args;
}

/** Build the Kaniko Job object — pure (no IO), so its shape is unit-testable. */
export function buildKanikoJob(input: BuildJobLaunchInput) {
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
							name: "kaniko",
							image: KANIKO_IMAGE,
							args: kanikoArgs(input),
							env: [
								{ name: "GIT_USERNAME", value: "x-access-token" },
								{
									name: "GIT_PASSWORD",
									valueFrom: {
										secretKeyRef: { name: GIT_SECRET, key: "token" },
									},
								},
							],
							resources,
							volumeMounts: [
								{ mountPath: "/kaniko/.docker", name: "docker-config" },
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
	const job = buildKanikoJob(input);
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
 * Read a build Job's terminal outcome. On success the Kaniko-written image
 * digest is recovered from the build pod's termination message
 * (`--digest-file=/dev/termination-log`) as build evidence.
 */
export async function readBuildOutcome(
	namespace: string,
	jobName: string,
): Promise<BuildOutcome> {
	const status = await readJobStatus(namespace, jobName);
	if (!status.done) return { done: false, succeeded: false };
	if (status.succeeded) {
		return {
			done: true,
			succeeded: true,
			digest: await readDigest(namespace, jobName),
		};
	}
	return {
		done: true,
		succeeded: false,
		reason: `Kaniko Job ${jobName} failed (backoff exhausted)`,
	};
}

/** Recover the image digest from the build pod's terminated container message. */
async function readDigest(
	namespace: string,
	jobName: string,
): Promise<string | undefined> {
	const clients = getDefaultClients();
	try {
		const pods = await clients.core.listNamespacedPod({
			namespace,
			labelSelector: `job-name=${jobName}`,
		});
		for (const pod of pods.items) {
			for (const cs of pod.status?.containerStatuses ?? []) {
				const msg = cs.state?.terminated?.message?.trim();
				if (msg?.startsWith("sha256:")) return msg;
			}
		}
	} catch {
		// best-effort — the digest is evidence, not control flow.
	}
	return undefined;
}
