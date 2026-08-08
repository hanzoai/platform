/**
 * smoke-runner — start the built image and watch it become ready, before anything
 * downstream believes in it.
 *
 * WHAT THIS CATCHES. A build proves the code COMPILES. It proves nothing about
 * whether the binary starts. api.hanzo.ai went down on an image that built clean
 * and then panicked at init on a duplicate route prefix — CrashLoopBackOff, on a
 * single-writer service with no safe rollback. Nothing between `docker push` and
 * production had ever run those bytes.
 *
 * So: run them. One pod, the exact image, the app's own readiness probe as the
 * verdict. Ready inside the deadline is the only pass; a panic, a config error, a
 * pull failure, an exit, or silence are all failures, and a failure promotes
 * nothing.
 *
 * ── PROD-FAITHFUL, PROD-INERT ─────────────────────────────────────────────────
 *
 * The pod spec is DERIVED FROM THE LIVE WORKLOAD, so env, secrets, ports, probes,
 * service account and placement are the real ones — a smoke against a spec we
 * invented would prove the image starts under conditions it will never meet. Four
 * deliberate departures, each one a way this could otherwise disturb the thing it
 * is testing:
 *
 *   labels     REPLACED, never copied. A Service selects on labels: a candidate
 *              wearing the app's labels joins the live Service's endpoints and
 *              takes production traffic. This is the single most dangerous line
 *              in the file, which is why the labels are built here rather than
 *              filtered from the template.
 *   volumes    Every PersistentVolumeClaim becomes an emptyDir. The claims here
 *              are ReadWriteOnce and the services behind them are single-writer
 *              (embedded Kafka, SQLite, `strategy: Recreate`); mounting the live
 *              claim would either block on the running pod or corrupt it.
 *   name       `<app>-smoke-<digest12>`, so the pod is named after the BYTES it
 *              is testing. Deterministic, so a re-tick adopts the pod already
 *              running instead of starting a second one.
 *   HANZO_SMOKE  set to 1 on every container. An app MAY read it to skip
 *              migrations, registration and writes. Nothing depends on it being
 *              honoured — an unhonouring app still panics on startup, which is
 *              the class this exists for — but it is the hook that lets a service
 *              make its smoke inert.
 *
 * Teardown is unconditional. A leaked candidate holding a secret and a service
 * account is worse than a slow pipeline, so the pod is deleted in a finally even
 * when the verdict throws.
 */
import { TRPCError } from "@trpc/server";
import { getDefaultClients } from "../k8s/k8s-client";
import { parseImageRef } from "./image-ref";

/**
 * How long an image gets to reach readiness. Generous enough for a cold JVM- or
 * Node-sized boot behind an `initialDelaySeconds`, short enough that a hung image
 * fails the build rather than the shift. One constant: an app that needs longer
 * says so in its readinessProbe, which is where that fact already lives.
 */
const DEADLINE_MS = 300_000;
/** Gap between status reads. The probe itself runs on the kubelet's schedule. */
const POLL_MS = 3_000;

/**
 * Container states that will not resolve themselves. Waiting on any of these is
 * a verdict, not a phase — `CrashLoopBackOff` in particular would otherwise burn
 * the whole deadline restating the same failure.
 */
const FATAL_WAITING = new Set([
	"CrashLoopBackOff",
	"CreateContainerConfigError",
	"CreateContainerError",
	"ErrImagePull",
	"ImagePullBackOff",
	"InvalidImageName",
	"RunContainerError",
]);

// --- the shapes this reads, structurally -------------------------------------
// Named as views rather than pulled from the client's model classes: the pure
// functions below are the part worth testing, and a test should be able to state
// a pod status as a literal.

export interface ContainerView {
	name: string;
	image?: string;
	env?: { name: string; value?: string; valueFrom?: unknown }[];
	[k: string]: unknown;
}

export interface VolumeView {
	name: string;
	persistentVolumeClaim?: unknown;
	emptyDir?: unknown;
	[k: string]: unknown;
}

export interface PodSpecView {
	containers?: ContainerView[];
	initContainers?: ContainerView[];
	volumes?: VolumeView[];
	[k: string]: unknown;
}

export interface PodTemplateView {
	metadata?: { labels?: Record<string, string>; [k: string]: unknown };
	spec?: PodSpecView;
}

export interface ContainerStatusView {
	name?: string;
	state?: {
		waiting?: { reason?: string; message?: string };
		terminated?: { reason?: string; exitCode?: number };
	};
}

export interface PodStatusView {
	phase?: string;
	conditions?: { type?: string; status?: string; reason?: string }[];
	containerStatuses?: ContainerStatusView[];
	initContainerStatuses?: ContainerStatusView[];
}

export type Verdict =
	| { done: false }
	| { done: true; passed: boolean; reason: string };

export interface SmokeInput {
	/** Namespace the live workload runs in — the smoke runs beside it. */
	namespace: string;
	/** Workload name (Deployment or StatefulSet). */
	name: string;
	/** The reference the build pushed, e.g. `ghcr.io/hanzoai/cloud:sha-e50ec914`. */
	image: string;
	/** Manifest digest of those bytes — names the pod and pins what runs. */
	digest: string;
	deadlineMs?: number;
}

export interface SmokeResult {
	passed: boolean;
	reason: string;
	pod: string;
}

/** Pod name: the app, and the bytes. DNS-safe by construction — hex only. */
export function smokePodName(name: string, digest: string): string {
	const hex = digest.replace(/^sha256:/, "").slice(0, 12);
	// 63-char DNS label budget, minus `-smoke-` and 12 hex.
	return `${name.slice(0, 44)}-smoke-${hex}`;
}

/**
 * Derive the candidate pod from the live workload's pod template.
 *
 * Throws when no container runs the image's repository: a smoke that changed
 * nothing would come back green having tested the version already in production,
 * which is worse than no smoke at all.
 */
export function smokePod(
	template: PodTemplateView,
	opts: { namespace: string; name: string; podName: string; image: string },
): Record<string, unknown> {
	const [repository] = parseImageRef(opts.image);
	const spec: PodSpecView = { ...(template.spec ?? {}) };

	let replaced = 0;
	const retarget = (list?: ContainerView[]): ContainerView[] | undefined =>
		list?.map((c) => {
			const isTarget = parseImageRef(c.image ?? "")[0] === repository;
			if (isTarget) replaced++;
			return {
				...c,
				...(isTarget ? { image: opts.image } : {}),
				env: withMarker(c.env),
			};
		});

	spec.containers = retarget(spec.containers);
	spec.initContainers = retarget(spec.initContainers);
	if (replaced === 0) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `no container in ${opts.namespace}/${opts.name} runs ${repository} — refusing a smoke that would test the running version`,
		});
	}

	// A ReadWriteOnce claim is attached to the node running the live pod, and the
	// services holding one here are single-writer. Same volume NAME so every
	// mountPath still resolves; different backing so nothing is shared.
	spec.volumes = spec.volumes?.map((v) =>
		v.persistentVolumeClaim ? { name: v.name, emptyDir: {} } : v,
	);

	// A crash must read as a crash. With `Always` the kubelet would restart the
	// container and the pod would sit in CrashLoopBackOff looking like slow boot.
	spec.restartPolicy = "Never";
	// `subdomain` enrols a pod in a headless Service's DNS; `nodeName` pins it to
	// whatever node the live pod happened to land on. Neither belongs to a
	// throwaway, and the first is another way to receive real traffic.
	delete spec.subdomain;
	delete spec.hostname;
	delete spec.nodeName;
	// A spread constraint written for N replicas can refuse to schedule one pod —
	// `DoNotSchedule` against a selector this pod deliberately does not match.
	delete spec.topologySpreadConstraints;

	return {
		apiVersion: "v1",
		kind: "Pod",
		metadata: {
			name: opts.podName,
			namespace: opts.namespace,
			// OURS ONLY — see the header. No label from the template survives.
			labels: {
				"app.kubernetes.io/name": "smoke",
				"app.kubernetes.io/managed-by": "platform",
				"hanzo.ai/smoke-of": opts.name,
			},
		},
		spec,
	};
}

/** Append the marker, unless the app already declares it. */
function withMarker(env: ContainerView["env"]): ContainerView["env"] {
	const declared = env ?? [];
	if (declared.some((e) => e.name === "HANZO_SMOKE")) return declared;
	return [...declared, { name: "HANZO_SMOKE", value: "1" }];
}

/**
 * Read a verdict out of a pod status. Total: every status is a pass, a fail, or
 * "still going", and the caller's deadline decides how long "still going" lasts.
 *
 * Failures are checked before readiness. A pod can report Ready on its app
 * container while a sidecar is in CrashLoopBackOff, and a partially-running
 * candidate is not a candidate.
 */
export function readVerdict(status: PodStatusView | undefined): Verdict {
	if (!status) return { done: false };

	if (status.phase === "Failed") {
		return { done: true, passed: false, reason: "pod failed" };
	}
	if (status.phase === "Succeeded") {
		return {
			done: true,
			passed: false,
			reason: "the image exited instead of serving",
		};
	}

	for (const cs of status.initContainerStatuses ?? []) {
		const fatal = fatalWaiting(cs);
		if (fatal) return { done: true, passed: false, reason: fatal };
		const t = cs.state?.terminated;
		if (t && (t.exitCode ?? 0) !== 0) {
			return {
				done: true,
				passed: false,
				reason: `init container ${cs.name} exited ${t.exitCode} (${t.reason ?? "no reason"})`,
			};
		}
	}

	for (const cs of status.containerStatuses ?? []) {
		const fatal = fatalWaiting(cs);
		if (fatal) return { done: true, passed: false, reason: fatal };
		const t = cs.state?.terminated;
		if (t) {
			return {
				done: true,
				passed: false,
				reason: `container ${cs.name} exited ${t.exitCode} (${t.reason ?? "no reason"})`,
			};
		}
	}

	const ready = status.conditions?.find((c) => c.type === "Ready");
	if (ready?.status === "True") {
		return { done: true, passed: true, reason: "ready" };
	}
	return { done: false };
}

function fatalWaiting(cs: ContainerStatusView): string | undefined {
	const w = cs.state?.waiting;
	if (!w?.reason || !FATAL_WAITING.has(w.reason)) return undefined;
	return `container ${cs.name} is ${w.reason}${w.message ? `: ${w.message.slice(0, 200)}` : ""}`;
}

/** The live workload's pod template — Deployment, else StatefulSet. */
async function readTemplate(
	namespace: string,
	name: string,
): Promise<PodTemplateView> {
	const clients = getDefaultClients();
	try {
		const d = await clients.apps.readNamespacedDeployment({ name, namespace });
		return (d.spec?.template ?? {}) as PodTemplateView;
	} catch (err) {
		if (!isNotFound(err)) throw err;
	}
	try {
		const s = await clients.apps.readNamespacedStatefulSet({ name, namespace });
		return (s.spec?.template ?? {}) as PodTemplateView;
	} catch (err) {
		if (!isNotFound(err)) throw err;
	}
	throw new TRPCError({
		code: "NOT_FOUND",
		message: `no Deployment or StatefulSet ${name} in ${namespace} — the smoke derives its pod from the live workload, so there is nothing to derive from`,
	});
}

/**
 * Run the smoke. Resolves with a verdict; a thrown error is the CALLER's cue to
 * treat the build as unverified — this never resolves `passed: true` on a path it
 * did not actually observe readiness.
 */
export async function smoke(input: SmokeInput): Promise<SmokeResult> {
	const { namespace, name, image, digest } = input;
	const podName = smokePodName(name, digest);
	const deadline = Date.now() + (input.deadlineMs ?? DEADLINE_MS);
	const clients = getDefaultClients();

	const template = await readTemplate(namespace, name);
	const body = smokePod(template, { namespace, name, podName, image });

	// The create is INSIDE the teardown guard. A create that fails after the
	// apiserver accepted it — a timeout, a dropped connection — leaves a pod
	// running with the app's secrets and nobody watching it. Deleting a pod that
	// was never made is a harmless 404; leaking one is not.
	try {
		try {
			await clients.core.createNamespacedPod({
				namespace,
				body: body as never,
			});
		} catch (err) {
			// A pod of this name is already running these exact bytes — a previous
			// tick started it. Adopt it rather than racing a second candidate.
			if (!isAlreadyExists(err)) throw err;
		}

		for (;;) {
			const pod = await clients.core.readNamespacedPod({
				name: podName,
				namespace,
			});
			const verdict = readVerdict(pod.status as PodStatusView | undefined);
			if (verdict.done) {
				return { passed: verdict.passed, reason: verdict.reason, pod: podName };
			}
			const left = deadline - Date.now();
			if (left <= 0) {
				return {
					passed: false,
					reason: `not ready within ${Math.round((input.deadlineMs ?? DEADLINE_MS) / 1000)}s`,
					pod: podName,
				};
			}
			// Never sleep past the deadline: a verdict that is already decided must
			// not wait a poll interval to be reported.
			await sleep(Math.min(POLL_MS, left));
		}
	} finally {
		// Unconditional: the candidate holds the app's secrets and service account.
		// A teardown failure is logged, never thrown — it must not overwrite the
		// verdict, and least of all turn a failed smoke into an error the caller
		// might read as something other than "do not promote".
		try {
			await clients.core.deleteNamespacedPod({ name: podName, namespace });
		} catch (err) {
			console.error(`[smoke] could not delete ${namespace}/${podName}`, err);
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function isNotFound(err: unknown): boolean {
	const e = err as { code?: number; statusCode?: number };
	return e.code === 404 || e.statusCode === 404;
}

function isAlreadyExists(err: unknown): boolean {
	const e = err as { code?: number; statusCode?: number };
	return e.code === 409 || e.statusCode === 409;
}
