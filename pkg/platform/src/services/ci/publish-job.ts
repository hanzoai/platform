/**
 * publish-job — the publish muscle.
 *
 * The fourth leg of the platform pipeline: build → deploy → test → PUBLISH.
 * Library / SDK repos declare a `publish:` block in `hanzo.yml`; after a
 * successful build (and, when configured, a passing e2e) the build-watcher
 * launches this in-cluster Job to ship the package to npm and/or PyPI — the
 * SAME pipeline that builds container images, so an SDK release needs no human
 * running `npm publish` / `twine upload` by hand.
 *
 * Registry tokens come from KMS-synced secrets mounted into the Job
 * (`npm-token` → NPM_TOKEN, `pypi-token` → PYPI_TOKEN, `cargo-token` →
 * CARGO_REGISTRY_TOKEN); they are NEVER hardcoded and never leave the Job.
 * `dryRun` builds + validates the package without uploading, so the stage is
 * provable without burning a version. Targets: npm, PyPI, and crates.io (cargo,
 * multi-crate workspaces published bottom-up via `cargoCrates`).
 *
 * Decomplected like `buildkit-job` / `e2e-runner`: this module owns ONLY "shape +
 * launch the publish Job"; the Job owns publishing; the watcher owns advancing
 * the row. It reuses the platform batch client — one k8s seam.
 */
import { TRPCError } from "@trpc/server";
import { branchOf, forgeHost, tagOf } from "../hanzo-git";
import { getDefaultClients } from "../k8s/k8s-client";
import type { PublishConfig } from "./platform-config";

/** Base image: Node (for npm) on Debian (apt installs Python/uv when pypi is set). */
const PUBLISH_IMAGE = "node:22-bookworm";
/**
 * Secret (key `token`) the Job presents to the forge to read source, named for
 * the host it authenticates to. Reconciles from KMS `hanzo/deploy` `FORGE_TOKEN`;
 * the forge serves no repository anonymously, so the mount is required and a
 * missing credential stops the pod instead of reaching a clone.
 */
const FORGE_SECRET = "git-hanzo-ai-token";
/** KMS-synced registry token secrets (key `token`); optional so dry-runs work pre-seed. */
const NPM_TOKEN_SECRET = "npm-token";
const PYPI_TOKEN_SECRET = "pypi-token";
const CARGO_TOKEN_SECRET = "cargo-token";
const CI_TOLERATION = {
	effect: "NoSchedule",
	key: "dedicated",
	operator: "Equal",
	value: "ci-runner",
} as const;

export interface PublishJobInput {
	/** `owner/name` — the source repository. */
	repo: string;
	/** The build's ref, whole — `refs/heads/main`, `refs/tags/v1.2.3`. */
	ref: string;
	/** Resolved publish config from `hanzo.yml`. */
	publish: PublishConfig;
	/** Stable correlation id (the buildJob id) for the Job name + labels. */
	buildJobId: string;
	/** Namespace to launch in. Default `hanzo`. */
	namespace?: string;
}

export interface PublishJobLaunch {
	jobName: string;
	namespace: string;
}

function dnsSafe(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

/** Deterministic RFC1123 publish Job name: `publish-<repo>-<id>`, ≤63 chars. */
export function publishJobName(repo: string, buildJobId: string): string {
	const name = dnsSafe(repo.split("/")[1] ?? repo);
	const id = dnsSafe(buildJobId).slice(0, 12);
	return `publish-${name}-${id}`.slice(0, 63).replace(/-$/, "");
}

/**
 * The publish script — pure, so the contract is unit-testable. Clones the repo,
 * then runs npm and/or PyPI publish under the configured dry-run policy. Fails
 * loud (`set -euo pipefail`) so a broken publish marks the Job failed.
 */
export function publishScript(publish: PublishConfig): string {
	const lines = [
		"set -euo pipefail",
		"cd /tmp",
		'git clone --depth 1 --branch "$GIT_BRANCH" ' +
			`"https://x-access-token:\${GIT_AUTH_TOKEN}@${forgeHost()}/\${REPO}.git" src`,
		'cd "src/${PACKAGE_DIR}"',
	];
	if (publish.npm) {
		lines.push(
			"# --- npm ---",
			'echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN:-}" > "$HOME/.npmrc"',
			"npm ci --no-audit --no-fund || npm install --no-audit --no-fund",
			publish.dryRun
				? "npm publish --access public --dry-run"
				: "npm publish --access public",
		);
	}
	if (publish.pypi) {
		lines.push(
			"# --- pypi ---",
			"apt-get update -qq && apt-get install -y -qq python3 python3-venv curl >/dev/null",
			"curl -LsSf https://astral.sh/uv/install.sh | sh",
			'export PATH="$HOME/.local/bin:$PATH"',
			"uv build",
			publish.dryRun
				? "uvx twine check dist/*"
				: 'uv publish --token "${PYPI_TOKEN:-}"',
		);
	}
	if (publish.cargo) {
		const crates = publish.cargoCrates.length
			? publish.cargoCrates.join(" ")
			: ".";
		lines.push(
			"# --- cargo (crates.io) ---",
			"apt-get update -qq && apt-get install -y -qq curl build-essential >/dev/null",
			"curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable",
			'export PATH="$HOME/.cargo/bin:$PATH"',
			// Bottom-up over the workspace crates; a crate already at this version is a
			// skip (not fatal), matching cargo's "already uploaded" contract. `set +e`
			// so an already-published leaf can't abort the rest (the bash -e trap).
			`for c in ${crates}; do`,
			'  ( cd "$c" && set +e',
			publish.dryRun
				? "    out=$(cargo publish --no-verify --dry-run 2>&1); rc=$?"
				: '    out=$(cargo publish --no-verify --token "${CARGO_REGISTRY_TOKEN:-}" 2>&1); rc=$?',
			'    echo "$out"',
			`    if [ "$rc" -ne 0 ] && ! echo "$out" | grep -qiE 'already (uploaded|exists)|is already uploaded'; then exit "$rc"; fi ) || exit $?`,
			"done",
		);
	}
	return lines.join("\n");
}

/** Build the publish Job object — pure (no IO). */
export function buildPublishJobObject(input: PublishJobInput) {
	const namespace = input.namespace ?? "hanzo";
	const name = publishJobName(input.repo, input.buildJobId);
	const labels = {
		"app.kubernetes.io/name": "publish",
		"app.kubernetes.io/managed-by": "platform",
		"triggered-by": "platform.hanzo.ai",
		"hanzo.ai/build-job-id": dnsSafe(input.buildJobId).slice(0, 63),
	};
	return {
		apiVersion: "batch/v1",
		kind: "Job",
		metadata: { name, namespace, labels },
		spec: {
			activeDeadlineSeconds: 1800,
			backoffLimit: 0,
			ttlSecondsAfterFinished: 86400,
			template: {
				metadata: { labels },
				spec: {
					automountServiceAccountToken: false,
					restartPolicy: "Never",
					nodeSelector: {
						"doks.digitalocean.com/node-pool": "runner-pool-32g",
					},
					tolerations: [CI_TOLERATION],
					containers: [
						{
							name: "publish",
							image: PUBLISH_IMAGE,
							command: ["bash", "-c"],
							args: [publishScript(input.publish)],
							env: [
								{ name: "REPO", value: input.repo },
								// `git clone --branch` wants the short name and takes either
								// kind, so the ref is shortened here — at the one place it
								// becomes an argument — rather than carried short.
								{
									name: "GIT_BRANCH",
									value: branchOf(input.ref) ?? tagOf(input.ref) ?? "",
								},
								{ name: "PACKAGE_DIR", value: input.publish.packageDir },
								{
									name: "GIT_AUTH_TOKEN",
									valueFrom: {
										secretKeyRef: { name: FORGE_SECRET, key: "token" },
									},
								},
								{
									name: "NPM_TOKEN",
									valueFrom: {
										secretKeyRef: {
											name: NPM_TOKEN_SECRET,
											key: "token",
											optional: true,
										},
									},
								},
								{
									name: "PYPI_TOKEN",
									valueFrom: {
										secretKeyRef: {
											name: PYPI_TOKEN_SECRET,
											key: "token",
											optional: true,
										},
									},
								},
								{
									name: "CARGO_REGISTRY_TOKEN",
									valueFrom: {
										secretKeyRef: {
											name: CARGO_TOKEN_SECRET,
											key: "token",
											optional: true,
										},
									},
								},
							],
							resources: {
								requests: { cpu: "500m", memory: "1Gi" },
								limits: { cpu: "2", memory: "4Gi" },
							},
						},
					],
				},
			},
		},
	};
}

/**
 * Launch the publish Job in-cluster. Idempotent by name: a re-launch of the
 * same buildJob hits 409 AlreadyExists (surfaced as CONFLICT) rather than
 * double-publishing.
 */
export async function launchPublishJob(
	input: PublishJobInput,
): Promise<PublishJobLaunch> {
	const job = buildPublishJobObject(input);
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
				message: `Publish Job ${job.metadata.name} already exists in ${namespace}`,
			});
		}
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: `Failed to launch publish Job in ${namespace}: ${e.body?.message ?? e.message ?? String(err)}`,
		});
	}
	return { jobName: job.metadata.name, namespace };
}
