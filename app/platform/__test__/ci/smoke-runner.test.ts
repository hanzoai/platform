/**
 * smoke-runner — the stage that makes a green build mean the image starts.
 *
 * Two properties are worth more than the rest and are tested hardest:
 *
 *   ISOLATION. The candidate must not be able to receive production traffic or
 *   touch production state. A Service selects on LABELS, so a candidate wearing
 *   the app's labels joins the live endpoints — that is a live outage caused by
 *   the thing meant to prevent one. A ReadWriteOnce claim is worse: the services
 *   behind them here are single-writer.
 *
 *   FAIL-CLOSED. Every status that is not "the app's own readiness probe passed"
 *   is a failure. A pod that exits 0, a sidecar in CrashLoopBackOff, an image that
 *   will not pull, or silence to the deadline all read as "do not promote".
 *
 * No cluster is contacted: the pure derivation and the pure verdict are exercised
 * directly, and the loop runs against a fake CoreV1Api that hands out scripted
 * statuses.
 */
import {
	type PodStatusView,
	type PodTemplateView,
	readVerdict,
	smoke,
	smokePod,
	smokePodName,
} from "@hanzo/platform/services/ci/smoke-runner";
import { beforeEach, describe, expect, it, vi } from "vitest";

const DIGEST =
	"sha256:60ca34bd76f3472f8c5b4903c6516686bbdfce696b4569aaa80c1fbac4e3085e";
const IMAGE = `ghcr.io/hanzoai/cloud:sha-new1234@${DIGEST}`;

/** The live workload's pod template, in the shape the fleet actually runs. */
function template(): PodTemplateView {
	return {
		metadata: {
			labels: {
				// The Service selector. Copying these is the outage.
				"app.kubernetes.io/name": "cloud",
				"app.kubernetes.io/instance": "cloud",
				app: "cloud",
			},
		},
		spec: {
			serviceAccountName: "cloud-sa",
			restartPolicy: "Always",
			nodeName: "pool-a-xyz",
			subdomain: "cloud",
			topologySpreadConstraints: [
				{
					topologyKey: "kubernetes.io/hostname",
					whenUnsatisfiable: "DoNotSchedule",
				},
			],
			nodeSelector: { "doks.digitalocean.com/node-pool": "pool-a" },
			imagePullSecrets: [{ name: "ghcr-secret" }],
			containers: [
				{
					name: "cloud",
					image: "ghcr.io/hanzoai/cloud:sha-old0000",
					env: [
						{ name: "PORT", value: "8080" },
						{
							name: "DB_PASSWORD",
							valueFrom: { secretKeyRef: { name: "cloud-secrets", key: "db" } },
						},
					],
					readinessProbe: { httpGet: { path: "/readyz", port: 8080 } },
					volumeMounts: [{ name: "data", mountPath: "/data" }],
				},
				{
					name: "metrics",
					image: "ghcr.io/hanzoai/o11y-agent:1.2.3",
					env: [],
				},
			],
			volumes: [
				{ name: "data", persistentVolumeClaim: { claimName: "cloud-data" } },
				{ name: "config", configMap: { name: "cloud-config" } },
			],
		},
	};
}

const opts = {
	namespace: "hanzo",
	name: "cloud",
	podName: "cloud-smoke-60ca34bd76f3",
	image: IMAGE,
};

describe("smokePodName — named after the bytes it tests", () => {
	it("is a legal DNS label built from the digest, so it is hex by construction", () => {
		const n = smokePodName("cloud", DIGEST);
		expect(n).toBe("cloud-smoke-60ca34bd76f3");
		expect(n).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
		expect(n.length).toBeLessThanOrEqual(63);
	});

	it("stays inside the label budget for a long workload name", () => {
		const n = smokePodName("a".repeat(80), DIGEST);
		expect(n.length).toBeLessThanOrEqual(63);
	});

	it("is deterministic, so a re-tick adopts the pod already running", () => {
		expect(smokePodName("cloud", DIGEST)).toBe(smokePodName("cloud", DIGEST));
	});
});

describe("smokePod — prod-faithful, prod-inert", () => {
	it("carries NONE of the app's labels — a Service must never select it", () => {
		const pod = smokePod(template(), opts) as {
			metadata: { labels: Record<string, string> };
		};
		expect(pod.metadata.labels).toEqual({
			"app.kubernetes.io/name": "smoke",
			"app.kubernetes.io/managed-by": "platform",
			"hanzo.ai/smoke-of": "cloud",
		});
		expect(pod.metadata.labels["app.kubernetes.io/instance"]).toBeUndefined();
		expect(pod.metadata.labels.app).toBeUndefined();
	});

	it("swaps every PersistentVolumeClaim for an emptyDir, keeping the volume name", () => {
		const pod = smokePod(template(), opts) as {
			spec: {
				volumes: {
					name: string;
					emptyDir?: unknown;
					persistentVolumeClaim?: unknown;
				}[];
			};
		};
		const data = pod.spec.volumes.find((v) => v.name === "data");
		expect(data?.persistentVolumeClaim).toBeUndefined();
		expect(data?.emptyDir).toEqual({});
		// The mountPath still resolves, so the container starts the same way.
		expect(data?.name).toBe("data");
		// A non-PVC volume is untouched.
		expect(pod.spec.volumes.find((v) => v.name === "config")).toHaveProperty(
			"configMap",
		);
	});

	it("runs the exact built image, and only on the container that shares its repository", () => {
		const pod = smokePod(template(), opts) as {
			spec: { containers: { name: string; image: string }[] };
		};
		expect(pod.spec.containers[0]?.image).toBe(IMAGE);
		// The sidecar keeps its own image — a smoke is not a fleet-wide bump.
		expect(pod.spec.containers[1]?.image).toBe(
			"ghcr.io/hanzoai/o11y-agent:1.2.3",
		);
	});

	it("refuses when no container runs that repository, rather than testing the running version", () => {
		expect(() =>
			smokePod(template(), { ...opts, image: "ghcr.io/hanzoai/other:v1" }),
		).toThrow(/refusing a smoke that would test the running version/);
	});

	it("sets HANZO_SMOKE=1 on every container, keeping the app's own env", () => {
		const pod = smokePod(template(), opts) as {
			spec: { containers: { env: { name: string; value?: string }[] }[] };
		};
		for (const c of pod.spec.containers) {
			expect(c.env).toContainEqual({ name: "HANZO_SMOKE", value: "1" });
		}
		// Real env and secret refs survive — the smoke is meant to be faithful.
		expect(pod.spec.containers[0]?.env).toContainEqual({
			name: "PORT",
			value: "8080",
		});
		expect(
			pod.spec.containers[0]?.env.some((e) => e.name === "DB_PASSWORD"),
		).toBe(true);
	});

	it("makes a crash read as a crash: restartPolicy Never", () => {
		const pod = smokePod(template(), opts) as {
			spec: { restartPolicy: string };
		};
		expect(pod.spec.restartPolicy).toBe("Never");
	});

	it("drops the ways a throwaway could be reached or pinned", () => {
		const pod = smokePod(template(), opts) as { spec: Record<string, unknown> };
		// subdomain enrols a pod in a headless Service's DNS.
		expect(pod.spec.subdomain).toBeUndefined();
		expect(pod.spec.nodeName).toBeUndefined();
		// A spread constraint written for N replicas can refuse to schedule one pod.
		expect(pod.spec.topologySpreadConstraints).toBeUndefined();
	});

	it("keeps the readiness probe — it IS the verdict — and the real placement", () => {
		const pod = smokePod(template(), opts) as {
			spec: {
				containers: { readinessProbe?: unknown }[];
				serviceAccountName: string;
				nodeSelector: Record<string, string>;
				imagePullSecrets: unknown;
			};
		};
		expect(pod.spec.containers[0]?.readinessProbe).toEqual({
			httpGet: { path: "/readyz", port: 8080 },
		});
		expect(pod.spec.serviceAccountName).toBe("cloud-sa");
		expect(pod.spec.nodeSelector).toEqual({
			"doks.digitalocean.com/node-pool": "pool-a",
		});
		expect(pod.spec.imagePullSecrets).toEqual([{ name: "ghcr-secret" }]);
	});

	it("does not mutate the live template it derived from", () => {
		const t = template();
		smokePod(t, opts);
		expect(t.spec?.containers?.[0]?.image).toBe(
			"ghcr.io/hanzoai/cloud:sha-old0000",
		);
		expect(t.spec?.restartPolicy).toBe("Always");
	});
});

describe("readVerdict — total, and failures win", () => {
	const ready: PodStatusView = {
		phase: "Running",
		conditions: [{ type: "Ready", status: "True" }],
	};

	it("passes only on the app's own Ready condition", () => {
		expect(readVerdict(ready)).toEqual({
			done: true,
			passed: true,
			reason: "ready",
		});
	});

	it("is not done while the pod is still coming up", () => {
		expect(
			readVerdict({
				phase: "Pending",
				conditions: [{ type: "Ready", status: "False" }],
			}),
		).toEqual({ done: false });
	});

	it("is not done on a status it has not seen yet", () => {
		expect(readVerdict(undefined)).toEqual({ done: false });
		expect(readVerdict({})).toEqual({ done: false });
	});

	it("fails a startup panic — this is the class that took api.hanzo.ai down", () => {
		const v = readVerdict({
			phase: "Running",
			containerStatuses: [
				{
					name: "cloud",
					state: {
						waiting: { reason: "CrashLoopBackOff", message: "back-off" },
					},
				},
			],
		});
		expect(v).toMatchObject({ done: true, passed: false });
		expect((v as { reason: string }).reason).toContain("CrashLoopBackOff");
	});

	it("fails an image that will not pull", () => {
		for (const reason of [
			"ImagePullBackOff",
			"ErrImagePull",
			"InvalidImageName",
		]) {
			expect(
				readVerdict({
					containerStatuses: [
						{ name: "cloud", state: { waiting: { reason } } },
					],
				}),
			).toMatchObject({ done: true, passed: false });
		}
	});

	it("fails a missing secret or bad config", () => {
		expect(
			readVerdict({
				containerStatuses: [
					{
						name: "cloud",
						state: { waiting: { reason: "CreateContainerConfigError" } },
					},
				],
			}),
		).toMatchObject({ done: true, passed: false });
	});

	it("fails a container that exited, even with status 0 — a server that exits is not ready", () => {
		expect(
			readVerdict({
				containerStatuses: [
					{
						name: "cloud",
						state: { terminated: { exitCode: 0, reason: "Completed" } },
					},
				],
			}),
		).toMatchObject({ done: true, passed: false });
		expect(readVerdict({ phase: "Succeeded" })).toMatchObject({
			done: true,
			passed: false,
		});
		expect(readVerdict({ phase: "Failed" })).toMatchObject({
			done: true,
			passed: false,
		});
	});

	it("fails a failed init container (a migration that could not run)", () => {
		expect(
			readVerdict({
				initContainerStatuses: [
					{
						name: "migrate",
						state: { terminated: { exitCode: 1, reason: "Error" } },
					},
				],
			}),
		).toMatchObject({ done: true, passed: false });
	});

	it("passes an init container that completed normally", () => {
		expect(
			readVerdict({
				...ready,
				initContainerStatuses: [
					{
						name: "wait",
						state: { terminated: { exitCode: 0, reason: "Completed" } },
					},
				],
			}),
		).toMatchObject({ done: true, passed: true });
	});

	it("refuses a pod that is Ready while a sidecar is crash-looping", () => {
		// A partially-running candidate is not a candidate: failures are checked
		// before the Ready condition, on purpose.
		expect(
			readVerdict({
				...ready,
				containerStatuses: [
					{ name: "cloud", state: {} },
					{
						name: "metrics",
						state: { waiting: { reason: "CrashLoopBackOff" } },
					},
				],
			}),
		).toMatchObject({ done: true, passed: false });
	});
});

// --- the loop, against a fake cluster ----------------------------------------

const cluster = vi.hoisted(() => ({
	statuses: [] as PodStatusView[],
	created: [] as Record<string, unknown>[],
	deleted: [] as string[],
	createError: null as unknown,
	deleteError: null as unknown,
	template: null as unknown,
	/** When true, neither a Deployment nor a StatefulSet of that name exists. */
	absent: false,
}));

vi.mock("@hanzo/platform/services/k8s/k8s-client", () => ({
	getDefaultClients: () => ({
		apps: {
			readNamespacedDeployment: vi.fn(async () => {
				if (cluster.absent) throw { code: 404 };
				return { spec: { template: cluster.template } };
			}),
			readNamespacedStatefulSet: vi.fn(async () => {
				throw { code: 404 };
			}),
		},
		core: {
			createNamespacedPod: vi.fn(
				async (p: { body: Record<string, unknown> }) => {
					cluster.created.push(p.body);
					if (cluster.createError) throw cluster.createError;
					return {};
				},
			),
			readNamespacedPod: vi.fn(async () => ({
				status: cluster.statuses.shift() ?? cluster.statuses[0] ?? {},
			})),
			deleteNamespacedPod: vi.fn(async (p: { name: string }) => {
				cluster.deleted.push(p.name);
				if (cluster.deleteError) throw cluster.deleteError;
				return {};
			}),
		},
	}),
}));

beforeEach(() => {
	cluster.statuses = [];
	cluster.created = [];
	cluster.deleted = [];
	cluster.createError = null;
	cluster.deleteError = null;
	cluster.absent = false;
	cluster.template = template();
});

describe("smoke — the run, and its guaranteed teardown", () => {
	const run = () =>
		smoke({
			namespace: "hanzo",
			name: "cloud",
			image: IMAGE,
			digest: DIGEST,
			deadlineMs: 50,
		});

	it("passes when the image reaches readiness, and deletes the pod after", async () => {
		cluster.statuses = [
			{ phase: "Pending" },
			{ phase: "Running", conditions: [{ type: "Ready", status: "True" }] },
		];
		const res = await run();
		expect(res).toMatchObject({
			passed: true,
			pod: "cloud-smoke-60ca34bd76f3",
		});
		expect(cluster.deleted).toEqual(["cloud-smoke-60ca34bd76f3"]);
	});

	it("fails a crash-looping candidate, and still deletes the pod", async () => {
		cluster.statuses = [
			{
				containerStatuses: [
					{ name: "cloud", state: { waiting: { reason: "CrashLoopBackOff" } } },
				],
			},
		];
		const res = await run();
		expect(res.passed).toBe(false);
		expect(cluster.deleted).toEqual(["cloud-smoke-60ca34bd76f3"]);
	});

	it("fails on the deadline rather than waiting forever, and deletes the pod", async () => {
		cluster.statuses = [{ phase: "Pending" }];
		const res = await run();
		expect(res.passed).toBe(false);
		expect(res.reason).toContain("not ready");
		expect(cluster.deleted).toEqual(["cloud-smoke-60ca34bd76f3"]);
	});

	it("tears down even when the create itself throws — an accepted-then-failed create leaks a pod holding real secrets", async () => {
		cluster.createError = { code: 500, message: "apiserver said no" };
		await expect(run()).rejects.toBeDefined();
		expect(cluster.deleted).toEqual(["cloud-smoke-60ca34bd76f3"]);
	});

	it("reports the verdict even when teardown fails — a delete error must not mask a refusal", async () => {
		cluster.deleteError = { code: 500 };
		cluster.statuses = [
			{
				containerStatuses: [
					{ name: "cloud", state: { waiting: { reason: "CrashLoopBackOff" } } },
				],
			},
		];
		const res = await run();
		expect(res.passed).toBe(false);
	});

	it("adopts a pod already smoking these exact bytes instead of racing a second", async () => {
		cluster.createError = { code: 409 };
		cluster.statuses = [
			{ phase: "Running", conditions: [{ type: "Ready", status: "True" }] },
		];
		const res = await run();
		expect(res.passed).toBe(true);
	});

	it("refuses when no live workload exists — there is nothing to derive a faithful pod from", async () => {
		cluster.absent = true;
		await expect(run()).rejects.toThrow(
			/no Deployment or StatefulSet cloud in hanzo/,
		);
		expect(cluster.created).toEqual([]);
	});
});
