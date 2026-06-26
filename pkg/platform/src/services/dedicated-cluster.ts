/**
 * Dedicated-cluster control plane — launch a customer's own "Hanzo K8S" cluster
 * and make it a first-class deploy target.
 *
 * This is the orchestration layer that turns the existing primitives into the
 * customer-facing flow "give org X its own dedicated cluster":
 *
 *   1. provisionDedicatedCluster — create a DOKS cluster for the org
 *      (reuses `doks-provisioner.provisionDoksCluster`; DO token comes from KMS).
 *   2. installClusterBaseline    — once the DOKS cluster is running, install the
 *      hanzo-operator + per-tenant baseline (namespaces, the PaaS-ticket shared
 *      secret, ingress + gateway) onto it via its on-demand kubeconfig.
 *   3. selectDeployTarget        — mark the dedicated cluster as the org's active
 *      deploy target (≤1 active per org).
 *   4. resolveOrgClusterTarget   — the keystone bridge: produce the EXISTING
 *      `ClusterTarget` (apps/inventory) for an org so BOTH the operator-apply
 *      path and the inventory reader retarget to the dedicated cluster with no
 *      new machinery. Shared cluster when the org has no active dedicated one.
 *   5. migrateOrgToDedicated     — re-point an org from the shared cluster to its
 *      dedicated one (flip the active target; existing CRs re-apply on next
 *      deploy — see the note on the return value).
 *
 * Composition over invention: nothing here re-implements DO calls, kubeconfig
 * fetching, k8s client construction, the tenant namespace convention, the PaaS
 * ticket, or the ClusterTarget abstraction — it wires them together.
 *
 * Secrets: ONLY via KMS (the DO token and the PaaS shared secret are read
 * through `kms.requireKmsSecret`). The per-cluster kubeconfig is never stored at
 * rest — it is derived on demand from DigitalOcean using the KMS-sourced DO
 * token, so the dedicated-cluster feature adds exactly zero new secrets to keep.
 */

import { db } from "@hanzo/platform/db";
import {
	type DoksPhase,
	type apiAttachExternalCluster,
	type apiProvisionDedicatedCluster,
	doksCluster,
} from "@hanzo/platform/db/schema";
import * as k8s from "@kubernetes/client-node";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { AppEnv, ClusterTarget } from "./apps/inventory";
import { DEFAULT_TARGETS } from "./apps/inventory";
import {
	findDoksClusterById,
	getDoksKubeconfig,
	provisionDoksCluster,
	type DoksCluster,
} from "./doks-provisioner";
import {
	createK8sClients,
	getDefaultClients,
	type K8sClients,
} from "./k8s/k8s-client";
import {
	OPERATOR_GROUP,
	OPERATOR_VERSION,
	tenantNamespace,
} from "./k8s/operator";
import { requireKmsSecret } from "./kms";
import { openSecret, sealSecret } from "./secret-box";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Namespace the hanzo-operator + cluster-wide baseline workloads live in. */
export const OPERATOR_NAMESPACE = "hanzo-system";

/** K8s Secret the operator's admission webhook reads to verify PaaS tickets. */
export const PAAS_TICKET_SECRET = "operator-paas-shared-secret";

/**
 * Source for the hanzo-operator install bundle (CRDs + controller + RBAC),
 * applied onto a freshly provisioned cluster. The operator publishes this; the
 * URL is KMS/env-configurable so a pinned semver bundle can be rolled without a
 * code change. Defaults to the canonical hanzoai/operator main bundle.
 */
export const OPERATOR_MANIFEST_URL =
	process.env.HANZO_OPERATOR_MANIFEST_URL ||
	"https://raw.githubusercontent.com/hanzoai/operator/main/k8s/crds/all-hanzo.ai.yaml";

/** Default storage class on DigitalOcean Kubernetes. */
const DO_STORAGE_CLASS = "do-block-storage";

// ---------------------------------------------------------------------------
// Baseline model (pure) — the declared per-cluster baseline
// ---------------------------------------------------------------------------

export interface BaselineNamespace {
	kind: "Namespace";
	name: string;
	labels: Record<string, string>;
}
export interface BaselineSecret {
	kind: "Secret";
	name: string;
	namespace: string;
	/** Plaintext value-by-key; applied as `stringData` (k8s base64-encodes). */
	stringData: Record<string, string>;
}
export interface BaselineOperatorBundle {
	kind: "OperatorBundle";
	manifestUrl: string;
}
export interface BaselineServiceCR {
	kind: "ServiceCR";
	name: string;
	namespace: string;
	/** Operator `Service` CR body (apiVersion hanzo.ai/v1, kind Service). */
	body: Record<string, unknown>;
}
export type BaselineObject =
	| BaselineNamespace
	| BaselineSecret
	| BaselineOperatorBundle
	| BaselineServiceCR;

export interface BaselineInput {
	organizationId: string;
	/** PaaS ticket shared secret (KMS-sourced) to seed into the new cluster. */
	sharedSecret: string;
	/** Override the operator bundle URL (defaults to OPERATOR_MANIFEST_URL). */
	operatorManifestUrl?: string;
	/** Storage class for tenant datastores (defaults to do-block-storage). */
	storageClassName?: string;
}

/** Build a minimal operator `Service` CR for a baseline workload (ingress/gateway). */
function baselineServiceCR(
	name: string,
	organizationId: string,
	image: string,
	port: number,
	component: "ingress" | "gateway",
): BaselineServiceCR {
	return {
		kind: "ServiceCR",
		name,
		namespace: OPERATOR_NAMESPACE,
		body: {
			apiVersion: `${OPERATOR_GROUP}/${OPERATOR_VERSION}`,
			kind: "Service",
			metadata: {
				name,
				namespace: OPERATOR_NAMESPACE,
				labels: {
					"app.kubernetes.io/managed-by": "hanzo-platform",
					"app.kubernetes.io/instance": name,
					"app.kubernetes.io/component": component,
					"hanzo.ai/tenant": organizationId,
				},
				annotations: { "hanzo.ai/paas-source": "platform.hanzo.ai" },
			},
			spec: {
				image: { repository: image, tag: "latest", pullPolicy: "IfNotPresent" },
				replicas: 1,
				ports: [{ name: component, containerPort: port, protocol: "TCP" }],
				component,
				partOf: `tenant-${organizationId}`,
			},
		},
	};
}

/**
 * Build the desired per-cluster baseline as an ordered, declarative object set.
 *
 * PURE — no IO, no DB, no network — so its wire shape is unit-tested exactly
 * like the operator CR builders. `installClusterBaseline` applies the result.
 *
 * Order matters: namespaces and the operator bundle (which registers the CRDs)
 * must exist before the `Service` CRs that depend on them.
 */
export function buildClusterBaseline(input: BaselineInput): BaselineObject[] {
	const tenantNs = tenantNamespace(input.organizationId);
	return [
		{
			kind: "Namespace",
			name: OPERATOR_NAMESPACE,
			labels: {
				"app.kubernetes.io/managed-by": "hanzo-platform",
				"hanzo.ai/part-of": "hanzo-operator",
			},
		},
		{
			kind: "Namespace",
			name: tenantNs,
			labels: {
				"app.kubernetes.io/managed-by": "hanzo-platform",
				"hanzo.ai/tenant": input.organizationId,
			},
		},
		{
			kind: "OperatorBundle",
			manifestUrl: input.operatorManifestUrl ?? OPERATOR_MANIFEST_URL,
		},
		{
			kind: "Secret",
			name: PAAS_TICKET_SECRET,
			namespace: OPERATOR_NAMESPACE,
			// The operator's tenant-mode admission webhook verifies platform's
			// PaaS tickets with this exact secret (see operator/tenant.ts). Seeding
			// it here is what lets the dedicated cluster trust platform's CRs.
			stringData: { secret: input.sharedSecret },
		},
		baselineServiceCR(
			"ingress",
			input.organizationId,
			"ghcr.io/hanzoai/ingress",
			80,
			"ingress",
		),
		baselineServiceCR(
			"gateway",
			input.organizationId,
			"ghcr.io/hanzoai/gateway",
			8080,
			"gateway",
		),
	];
}

// ---------------------------------------------------------------------------
// Phase reducer (pure)
// ---------------------------------------------------------------------------

export type PhaseEvent =
	| "provisionStarted"
	| "doksRunning"
	| "baselineStarted"
	| "baselineDone"
	| "failed";

/**
 * Total, pure transition for the provisioning lifecycle. Illegal transitions
 * return the current phase unchanged (no exceptions, no illegal jumps), so a
 * stray event can never corrupt the recorded state. `failed` always wins.
 */
export function nextPhase(current: DoksPhase, event: PhaseEvent): DoksPhase {
	if (event === "failed") return "error";
	switch (event) {
		case "provisionStarted":
			return current === "requested" || current === "error"
				? "provisioning"
				: current;
		case "doksRunning":
			return current === "provisioning" ? "installing" : current;
		case "baselineStarted":
			return current === "installing" ||
				current === "ready" ||
				current === "error"
				? "installing"
				: current;
		case "baselineDone":
			return current === "installing" ? "ready" : current;
		default:
			return current;
	}
}

// ---------------------------------------------------------------------------
// ClusterTarget mapping (pure) — the bridge to operator-apply + inventory
// ---------------------------------------------------------------------------

/**
 * Map a dedicated-cluster DB record (+ its on-demand kubeconfig) to the EXISTING
 * `ClusterTarget` consumed by both the operator-apply path and the apps
 * inventory reader. PURE — the caller fetches the kubeconfig.
 *
 * A dedicated cluster runs the org's workloads in its tenant namespace; that
 * namespace maps to the `main` env (a dedicated cluster is a single-env home,
 * not the shared 3-env split).
 */
export function clusterTargetFromRecord(
	record: Pick<DoksCluster, "name" | "organizationId">,
	kubeconfig: string,
	env: AppEnv = "main",
): ClusterTarget {
	return {
		cluster: record.name,
		namespaces: { [tenantNamespace(record.organizationId)]: env },
		kubeconfig,
	};
}

/** Kubeconfig-free projection of a ClusterTarget — safe to return over the API. */
export interface ClusterTargetView {
	cluster: string;
	namespaces: Record<string, AppEnv>;
	/** True when the org resolves to a dedicated cluster (vs. the shared one). */
	dedicated: boolean;
}

/**
 * Redact a ClusterTarget for transport: drop the kubeconfig (a secret) and
 * expose only whether the target is dedicated. PURE.
 */
export function redactTarget(target: ClusterTarget): ClusterTargetView {
	return {
		cluster: target.cluster,
		namespaces: target.namespaces,
		dedicated: Boolean(target.kubeconfig),
	};
}

// ---------------------------------------------------------------------------
// IO: provisioning + baseline install (thin composition over primitives)
// ---------------------------------------------------------------------------

/** All dedicated clusters owned by an org. */
export async function listOrgClusters(
	organizationId: string,
): Promise<DoksCluster[]> {
	return db.query.doksCluster.findMany({
		where: (c, { eq: eqOp }) => eqOp(c.organizationId, organizationId),
	});
}

async function setPhase(
	doksClusterId: string,
	phase: DoksPhase,
	extra: Partial<typeof doksCluster.$inferInsert> = {},
): Promise<void> {
	await db
		.update(doksCluster)
		.set({ phase, ...extra })
		.where(eq(doksCluster.doksClusterId, doksClusterId));
}

/**
 * Provision a dedicated Hanzo K8S cluster for an org. Asserts the DO token is
 * KMS-available BEFORE any side effect (fail fast), then reuses the DOKS
 * provisioner to create the cluster + persist the record, and advances the
 * lifecycle to `provisioning`. The operator + baseline are installed separately
 * by `installClusterBaseline` once the DOKS cluster reaches `running`.
 */
export async function provisionDedicatedCluster(
	input: z.infer<typeof apiProvisionDedicatedCluster>,
): Promise<DoksCluster> {
	// Fail fast and loud if the DO token is not KMS-provisioned — never proceed
	// to create a paid cluster with a missing/hardcoded credential.
	requireKmsSecret("PAAS_DO_API_TOKEN");

	const cluster = await provisionDoksCluster(input);
	await setPhase(cluster.doksClusterId, nextPhase("requested", "provisionStarted"));
	return { ...cluster, phase: "provisioning" };
}

/**
 * Attach an external (bring-your-own) Kubernetes cluster as a deploy target for
 * an org. Platform never provisioned this one: there is no DigitalOcean cluster
 * behind it (`doClusterId` stays NULL), so its kubeconfig is the one credential
 * platform must keep — sealed (AES-256-GCM, services/secret-box), never
 * plaintext.
 *
 * The kubeconfig is validated (must parse + expose a server endpoint) before it
 * is sealed and persisted. The record lands `status=running`, `phase=ready` (a
 * BYO cluster is already up), so it can be selected immediately as the org's
 * deploy target; `active` stays false until the org selects it. The returned
 * record omits the ciphertext.
 */
export async function attachExternalCluster(
	input: z.infer<typeof apiAttachExternalCluster>,
): Promise<Omit<DoksCluster, "kubeconfigEncrypted">> {
	const org = await db.query.organization.findFirst({
		where: (o, { eq: eqOp }) => eqOp(o.id, input.organizationId),
	});
	if (!org) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
	}

	// Validate the kubeconfig parses and capture its endpoint. createK8sClients
	// (loadFromString) throws on a malformed kubeconfig.
	let endpoint: string | null = null;
	try {
		endpoint =
			createK8sClients(input.kubeconfig).kc.getCurrentCluster()?.server ?? null;
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Invalid kubeconfig: ${(err as Error).message}`,
		});
	}

	const inserted = await db
		.insert(doksCluster)
		.values({
			name: input.name,
			doClusterId: null,
			kubeconfigEncrypted: sealSecret(input.kubeconfig),
			region: "external",
			status: "running",
			phase: "ready",
			endpoint,
			organizationId: input.organizationId,
			tags: ["external", "byo"],
		})
		.returning()
		.then((rows) => rows[0]);

	if (!inserted) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to save cluster record",
		});
	}

	// Never hand the ciphertext back to callers.
	const { kubeconfigEncrypted: _omit, ...safe } = inserted;
	return safe;
}

/** Idempotent namespace apply (ignores AlreadyExists). */
async function ensureNamespace(
	clients: K8sClients,
	obj: BaselineNamespace,
): Promise<void> {
	try {
		await clients.core.createNamespace({
			body: { metadata: { name: obj.name, labels: obj.labels } },
		});
	} catch (err) {
		if (!isConflict(err)) throw err;
	}
}

/** Idempotent Secret apply (create, else replace). */
async function ensureSecret(
	clients: K8sClients,
	obj: BaselineSecret,
): Promise<void> {
	const body = {
		metadata: { name: obj.name, namespace: obj.namespace },
		stringData: obj.stringData,
		type: "Opaque",
	};
	try {
		await clients.core.createNamespacedSecret({ namespace: obj.namespace, body });
	} catch (err) {
		if (!isConflict(err)) throw err;
		await clients.core.replaceNamespacedSecret({
			name: obj.name,
			namespace: obj.namespace,
			body,
		});
	}
}

/** Idempotent operator `Service` CR apply (create, else replace). */
async function ensureServiceCR(
	clients: K8sClients,
	obj: BaselineServiceCR,
): Promise<void> {
	const args = {
		group: OPERATOR_GROUP,
		version: OPERATOR_VERSION,
		namespace: obj.namespace,
		plural: "services",
	};
	try {
		await clients.custom.createNamespacedCustomObject({
			...args,
			body: obj.body as object,
		});
	} catch (err) {
		if (!isConflict(err)) throw err;
		await clients.custom.replaceNamespacedCustomObject({
			...args,
			name: obj.name,
			body: obj.body as object,
		});
	}
}

/**
 * Fetch + apply a multi-document YAML manifest bundle (the hanzo-operator
 * install) using server-side create-or-replace per object. CRDs and the
 * controller ship in one bundle; applying each object idempotently is enough to
 * bring the operator up on a fresh cluster.
 */
async function applyManifestBundle(
	clients: K8sClients,
	manifestUrl: string,
): Promise<void> {
	const res = await fetch(manifestUrl);
	if (!res.ok) {
		throw new Error(
			`Cannot fetch operator manifest ${manifestUrl}: HTTP ${res.status}`,
		);
	}
	const yaml = await res.text();
	const objects = k8s.loadAllYaml(yaml) as k8s.KubernetesObject[];
	const objectApi = k8s.KubernetesObjectApi.makeApiClient(clients.kc);
	for (const obj of objects) {
		if (!obj?.kind || !obj.metadata?.name) continue;
		try {
			await objectApi.create(obj);
		} catch (err) {
			if (!isConflict(err)) throw err;
			await objectApi.replace(obj);
		}
	}
}

/** Apply an ordered baseline object set onto a target cluster's clients. */
export async function applyClusterBaseline(
	clients: K8sClients,
	objects: BaselineObject[],
): Promise<void> {
	for (const obj of objects) {
		switch (obj.kind) {
			case "Namespace":
				await ensureNamespace(clients, obj);
				break;
			case "OperatorBundle":
				await applyManifestBundle(clients, obj.manifestUrl);
				break;
			case "Secret":
				await ensureSecret(clients, obj);
				break;
			case "ServiceCR":
				await ensureServiceCR(clients, obj);
				break;
		}
	}
}

/**
 * Install the hanzo-operator + per-tenant baseline onto a provisioned dedicated
 * cluster. Resolves the cluster's kubeconfig ON DEMAND (derived from DO with the
 * KMS DO token — nothing stored), builds the baseline (pure), and applies it.
 *
 * Advances the lifecycle to `ready` on success, or records `baselineError` and
 * phase `error` on failure (so the UI can surface + the caller can retry).
 */
export async function installClusterBaseline(
	doksClusterId: string,
): Promise<DoksCluster> {
	const record = await findDoksClusterById(doksClusterId);
	if (record.status !== "running") {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: `Cluster ${doksClusterId} is "${record.status}", not "running" — wait for the DOKS cluster to come up before installing the baseline`,
		});
	}

	// Move to `installing` from whatever the actual phase is: first install comes
	// from `provisioning` (doksRunning); a re-install/reconcile comes from
	// `ready`/`error`/`installing` (baselineStarted). The reducer is the authority.
	const startEvent =
		record.phase === "provisioning" ? "doksRunning" : "baselineStarted";
	await setPhase(doksClusterId, nextPhase(record.phase, startEvent)); // → installing

	try {
		const kubeconfig = await getDoksKubeconfig(doksClusterId);
		const clients = createK8sClients(kubeconfig);
		const objects = buildClusterBaseline({
			organizationId: record.organizationId,
			sharedSecret: requireKmsSecret("OPERATOR_PAAS_SHARED_SECRET"),
			storageClassName: DO_STORAGE_CLASS,
		});
		await applyClusterBaseline(clients, objects);
		await setPhase(doksClusterId, "ready", {
			operatorInstalled: true,
			baselineInstalled: true,
			baselineError: null,
		});
		return {
			...record,
			phase: "ready",
			operatorInstalled: true,
			baselineInstalled: true,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await setPhase(doksClusterId, "error", { baselineError: message });
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: `Baseline install failed for ${doksClusterId}: ${message}`,
		});
	}
}

// ---------------------------------------------------------------------------
// Deploy-target selection + resolution
// ---------------------------------------------------------------------------

/**
 * Select an org's active deploy target. Enforces ≤1 active cluster per org:
 * clears the flag on all the org's clusters, then sets it on the chosen one.
 * Passing `null` reverts the org to the shared cluster (clear all).
 */
export async function selectDeployTarget(
	organizationId: string,
	doksClusterId: string | null,
): Promise<void> {
	await db
		.update(doksCluster)
		.set({ active: false })
		.where(eq(doksCluster.organizationId, organizationId));

	if (!doksClusterId) return;

	const target = await findDoksClusterById(doksClusterId);
	if (target.organizationId !== organizationId) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Cluster belongs to a different organization",
		});
	}
	if (target.phase !== "ready") {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: `Cluster ${doksClusterId} is not ready (phase=${target.phase}); install the baseline before selecting it`,
		});
	}
	await db
		.update(doksCluster)
		.set({ active: true })
		.where(eq(doksCluster.doksClusterId, doksClusterId));
}

/**
 * Resolve a cluster record's kubeconfig on demand. Managed (DOKS) clusters
 * derive it fresh from DigitalOcean; external (BYO) clusters — which have no
 * `doClusterId` — decrypt the kubeconfig stored at attach time. One resolver,
 * so every consumer (target resolution, baseline install) is BYO-aware.
 */
export async function clusterKubeconfig(
	record: Pick<DoksCluster, "doksClusterId" | "doClusterId" | "kubeconfigEncrypted">,
): Promise<string> {
	if (record.kubeconfigEncrypted) {
		return openSecret(record.kubeconfigEncrypted);
	}
	return getDoksKubeconfig(record.doksClusterId);
}

/**
 * Resolve the operator/inventory target for an org: its active, ready cluster
 * (dedicated DOKS or attached BYO) when one exists, else the shared cluster.
 * THIS is the single function both the operator-apply path and the inventory
 * reader call to know "where do this org's workloads live".
 */
export async function resolveOrgClusterTarget(
	organizationId: string,
): Promise<ClusterTarget> {
	const active = await db.query.doksCluster.findFirst({
		where: (c, { and: andOp, eq: eqOp }) =>
			andOp(eqOp(c.organizationId, organizationId), eqOp(c.active, true)),
	});
	if (active && active.phase === "ready" && active.status === "running") {
		const kubeconfig = await clusterKubeconfig(active);
		return clusterTargetFromRecord(active, kubeconfig);
	}
	return DEFAULT_TARGETS[0]!;
}

/**
 * The ONE choke point a targeted deploy goes through: resolve the org's active
 * cluster target and hand back typed K8s clients pinned to it — a remote cluster
 * when the org has one selected, else the shared in-cluster SA. Used by the CI
 * deploy executor so a rollout lands on the org's own cluster.
 */
export async function resolveOrgClusterClients(
	organizationId: string,
): Promise<K8sClients> {
	const target = await resolveOrgClusterTarget(organizationId);
	return target.kubeconfig
		? createK8sClients(target.kubeconfig)
		: getDefaultClients();
}

export interface MigrationPlan {
	organizationId: string;
	target: ClusterTarget;
	/** Human-readable description of what the re-point does and what follows. */
	note: string;
}

/**
 * Re-point an org from the shared cluster to its dedicated one. Selects the
 * dedicated cluster as the active target and returns the resolved target.
 *
 * What this does today: every SUBSEQUENT operator-apply (deploy/redeploy via the
 * CI deploy-executor) and inventory pass resolves through
 * `resolveOrgClusterTarget` and therefore lands on the dedicated cluster. Moving
 * the org's ALREADY-RUNNING CRs is a re-apply of each Service CR against the new
 * target — wired through the same `resolveOrgClusterTarget` bridge, queued as a
 * follow-up (the bulk re-apply) so this step stays a safe, instant re-point.
 */
export async function migrateOrgToDedicated(
	organizationId: string,
): Promise<MigrationPlan> {
	const dedicated = await db.query.doksCluster.findFirst({
		where: (c, { and: andOp, eq: eqOp }) =>
			andOp(eqOp(c.organizationId, organizationId), eqOp(c.phase, "ready")),
	});
	if (!dedicated) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"No ready dedicated cluster for this org — provision one and install its baseline first",
		});
	}
	await selectDeployTarget(organizationId, dedicated.doksClusterId);
	const target = await resolveOrgClusterTarget(organizationId);
	return {
		organizationId,
		target,
		note: `Org re-pointed to dedicated cluster "${dedicated.name}". New deploys + inventory now target it; existing CRs re-apply on next deploy.`,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when a k8s API error is a 409 AlreadyExists / Conflict. */
function isConflict(err: unknown): boolean {
	const e = err as {
		statusCode?: number;
		code?: number;
		response?: { statusCode?: number; body?: { reason?: string; code?: number } };
		body?: { reason?: string; code?: number };
		message?: string;
	};
	const status =
		e.statusCode ??
		e.code ??
		e.response?.statusCode ??
		e.response?.body?.code ??
		e.body?.code;
	const reason = e.response?.body?.reason ?? e.body?.reason;
	return (
		status === 409 ||
		reason === "AlreadyExists" ||
		(typeof e.message === "string" && e.message.includes("already exists"))
	);
}
