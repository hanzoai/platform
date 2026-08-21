/**
 * e2e-runner — platform-driven end-to-end test execution.
 *
 * The third leg of the control plane: platform builds (arcd → buildkit Jobs),
 * deploys (operator CR patch), and TESTS (this module → a Playwright Job). The
 * test muscle, like the build muscle, runs on our own cluster — no GitHub
 * Actions. Platform launches a Playwright Job in-cluster that clones the
 * `universe` e2e suite at a ref and runs the chosen spec against the LIVE
 * services, then reports the Job name to poll for completion.
 *
 * Decomplected: this module owns ONLY "shape + launch the e2e Job"; the Job
 * (Playwright image) owns running the tests; the operator/services own being
 * tested. It reuses the platform's existing k8s batch client — the same client
 * that drives builds and deploys — so there is one k8s seam, not three.
 */
import { TRPCError } from "@trpc/server";
import { forgeHost } from "../hanzo-git";
import { getDefaultClients } from "../k8s/k8s-client";

/** Where the e2e suite lives and the Job's runtime knobs. */
export interface E2eRunInput {
	/** Playwright spec(s) to run, relative to universe/e2e (e.g. tests/00-health.spec.ts). */
	spec?: string;
	/** Base domain under test (E2E_BASE_DOMAIN). Default hanzo.ai. */
	baseDomain?: string;
	/** universe git ref to test from. Default main. */
	ref?: string;
	/** Namespace to launch the Job in. Default hanzo. */
	namespace?: string;
}

export interface E2eRunResult {
	jobName: string;
	namespace: string;
	spec: string;
	baseDomain: string;
}

const PLAYWRIGHT_IMAGE = "mcr.microsoft.com/playwright:v1.50.0-noble";
/**
 * Secret (key `token`) the Job presents to the forge, named for the host it
 * authenticates to. Reconciles from KMS `hanzo/deploy` `FORGE_TOKEN`; the forge
 * serves no repository anonymously, so the mount is required and a missing
 * credential stops the pod instead of reaching a clone.
 */
const FORGE_SECRET = "git-hanzo-ai-token";
/**
 * The e2e suite's home. `hanzo/universe` is the canonical universe — the repo
 * the estate's declared state is committed to and the one carrying `e2e/`.
 */
const UNIVERSE_REPO = "hanzo/universe";

/**
 * The e2e script — pure, so the contract is unit-testable. Clones the universe
 * at the requested ref, installs the e2e workspace, and runs the chosen spec.
 * Fails loud (`set -euo pipefail`) so a broken run marks the Job failed.
 */
export function e2eScript(): string {
	return [
		"set -euo pipefail",
		"cd /tmp",
		'git clone --depth 1 --branch "$E2E_REF" ' +
			`"https://x-access-token:\${GIT_AUTH_TOKEN}@${forgeHost()}/${UNIVERSE_REPO}.git" universe`,
		"cd universe/e2e",
		"npm ci --no-audit --no-fund",
		'npx playwright test "$E2E_SPEC" --reporter=line',
	].join("\n");
}

/** Resolve the defaults once, so the Job and its result agree on every value. */
function settle(input: E2eRunInput) {
	return {
		spec: input.spec ?? "tests/00-health.spec.ts",
		baseDomain: input.baseDomain ?? "hanzo.ai",
		ref: input.ref ?? "main",
		namespace: input.namespace ?? "hanzo",
	};
}

/** Build the e2e Job object — pure (no IO), like `buildPublishJobObject`. */
export function buildE2eJobObject(input: E2eRunInput, jobName: string) {
	const { spec, baseDomain, ref, namespace } = settle(input);
	const script = e2eScript();

	return {
		apiVersion: "batch/v1",
		kind: "Job",
		metadata: {
			name: jobName,
			namespace,
			labels: {
				"app.kubernetes.io/name": "e2e",
				"app.kubernetes.io/managed-by": "platform",
				"triggered-by": "platform.hanzo.ai",
			},
		},
		spec: {
			activeDeadlineSeconds: 1200,
			backoffLimit: 0,
			ttlSecondsAfterFinished: 86400,
			template: {
				metadata: {
					labels: {
						"app.kubernetes.io/name": "e2e",
						"app.kubernetes.io/managed-by": "platform",
					},
				},
				spec: {
					restartPolicy: "Never",
					nodeSelector: {
						"doks.digitalocean.com/node-pool": "runner-pool-32g",
					},
					tolerations: [
						{
							effect: "NoSchedule",
							key: "dedicated",
							operator: "Equal",
							value: "ci-runner",
						},
					],
					containers: [
						{
							name: "e2e",
							image: PLAYWRIGHT_IMAGE,
							command: ["bash", "-c"],
							args: [script],
							env: [
								{ name: "E2E_BASE_DOMAIN", value: baseDomain },
								{ name: "E2E_SPEC", value: spec },
								{ name: "E2E_REF", value: ref },
								{
									name: "GIT_AUTH_TOKEN",
									valueFrom: {
										secretKeyRef: { name: FORGE_SECRET, key: "token" },
									},
								},
							],
							resources: {
								requests: { cpu: "1", memory: "2Gi" },
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
 * Launch the e2e Job. Returns its name; poll Job status (or its pod logs) for
 * the result. The Job clones universe@ref, `npm ci`s the e2e workspace, and
 * runs `playwright test <spec>` against https://<baseDomain>.
 */
export async function runE2e(input: E2eRunInput): Promise<E2eRunResult> {
	const { spec, baseDomain, namespace } = settle(input);
	const jobName = `e2e-${Date.now()}`;
	const job = buildE2eJobObject(input, jobName);

	const clients = getDefaultClients();
	try {
		// Reuse the platform's batch client — the same k8s seam that drives
		// builds (Jobs) and deploys (CR patch via custom client).
		await clients.batch.createNamespacedJob({ namespace, body: job as never });
	} catch (err) {
		const e = err as { body?: { message?: string }; message?: string };
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: `Failed to launch e2e Job in ${namespace}: ${e.body?.message ?? e.message ?? String(err)}`,
		});
	}

	return { jobName, namespace, spec, baseDomain };
}
