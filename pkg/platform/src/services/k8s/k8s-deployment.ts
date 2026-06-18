/**
 * Kubernetes Deployment management.
 *
 * Ported from: paas/platform/handlers/deployment.js
 * Uses @kubernetes/client-node v1.x request-object API.
 */

import { TRPCError } from "@trpc/server";
import { PatchStrategy, setHeaderOptions } from "@kubernetes/client-node";
import { loadManifestParsed } from "../../templates/k8s/index";
import type { K8sClients } from "./k8s-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeploymentSpec {
	name: string;
	image: string;
	replicas?: number;
	containerPort: number;
	resources?: {
		cpuRequest?: string;
		cpuLimit?: string;
		memoryRequest?: string;
		memoryLimit?: string;
	};
	env?: Array<{ name: string; value: string }>;
	restartPolicy?: string;
	labels?: Record<string, string>;
	storage?: {
		mountPath: string;
		claimName: string;
	};
}

export interface DeploymentStatus {
	ready: number;
	available: number;
	unavailable: number;
	replicas: number;
	updatedReplicas: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function k8sError(err: unknown): string {
	const e = err as { response?: { body?: { message?: string } }; message?: string };
	return e.response?.body?.message ?? e.message ?? String(err);
}

async function getExisting(
	clients: K8sClients,
	namespace: string,
	name: string,
): Promise<any | null> {
	try {
		return await clients.apps.readNamespacedDeployment({ name, namespace });
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createDeployment(
	clients: K8sClients,
	namespace: string,
	spec: DeploymentSpec,
): Promise<void> {
	const [resource] = loadManifestParsed("deployment") as [any];
	const { metadata } = resource;
	const dSpec = resource.spec;

	metadata.name = spec.name;
	metadata.namespace = namespace;
	dSpec.replicas = spec.replicas ?? 1;
	dSpec.selector.matchLabels.app = spec.name;
	dSpec.template.metadata.labels = { app: spec.name, ...spec.labels };

	if (spec.restartPolicy) {
		dSpec.template.spec.restartPolicy = spec.restartPolicy;
	}

	const container = dSpec.template.spec.containers[0];
	container.name = spec.name;
	container.image = spec.image;
	container.ports[0].containerPort = spec.containerPort;

	if (spec.resources) {
		container.resources.requests.cpu = spec.resources.cpuRequest ?? "100m";
		container.resources.requests.memory = spec.resources.memoryRequest ?? "256Mi";
		container.resources.limits.cpu = spec.resources.cpuLimit ?? "1";
		container.resources.limits.memory = spec.resources.memoryLimit ?? "1Gi";
	}

	container.env = [
		{ name: "HANZO_NAMESPACE", value: namespace },
		{ name: "HANZO_CONTAINER_IID", value: spec.name },
		...(spec.env ?? []),
	];

	delete container.startupProbe;
	delete container.readinessProbe;
	delete container.livenessProbe;

	if (spec.storage) {
		container.volumeMounts = [{ name: "storage", mountPath: spec.storage.mountPath }];
		dSpec.template.spec.volumes = [
			{ name: "storage", persistentVolumeClaim: { claimName: spec.storage.claimName } },
		];
	} else {
		delete container.volumeMounts;
		delete dSpec.template.spec.volumes;
	}

	try {
		await clients.apps.createNamespacedDeployment({ namespace, body: resource });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot create deployment '${spec.name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function updateDeployment(
	clients: K8sClients,
	namespace: string,
	name: string,
	spec: Partial<DeploymentSpec>,
): Promise<void> {
	const existing = await getExisting(clients, namespace, name);
	if (!existing) {
		throw new TRPCError({ code: "NOT_FOUND", message: `Deployment '${name}' not found in '${namespace}'` });
	}

	const dSpec = existing.spec;
	const container = dSpec.template.spec.containers[0];

	if (spec.replicas !== undefined) dSpec.replicas = spec.replicas;
	if (spec.image) container.image = spec.image;
	if (spec.containerPort !== undefined) container.ports[0].containerPort = spec.containerPort;
	if (spec.env) {
		container.env = [
			{ name: "HANZO_NAMESPACE", value: namespace },
			{ name: "HANZO_CONTAINER_IID", value: name },
			...spec.env,
		];
	}
	if (spec.resources) {
		if (spec.resources.cpuRequest) container.resources.requests.cpu = spec.resources.cpuRequest;
		if (spec.resources.memoryRequest) container.resources.requests.memory = spec.resources.memoryRequest;
		if (spec.resources.cpuLimit) container.resources.limits.cpu = spec.resources.cpuLimit;
		if (spec.resources.memoryLimit) container.resources.limits.memory = spec.resources.memoryLimit;
	}
	if (spec.labels) {
		dSpec.template.metadata.labels = { app: name, ...spec.labels };
	}
	if (spec.storage) {
		container.volumeMounts = [{ name: "storage", mountPath: spec.storage.mountPath }];
		dSpec.template.spec.volumes = [
			{ name: "storage", persistentVolumeClaim: { claimName: spec.storage.claimName } },
		];
	}

	try {
		await clients.apps.replaceNamespacedDeployment({ name, namespace, body: existing });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot update deployment '${name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function deleteDeployment(
	clients: K8sClients,
	namespace: string,
	name: string,
): Promise<void> {
	if (!(await getExisting(clients, namespace, name))) return;
	try {
		await clients.apps.deleteNamespacedDeployment({ name, namespace });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot delete deployment '${name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function getDeployment(
	clients: K8sClients,
	namespace: string,
	name: string,
): Promise<any> {
	const result = await getExisting(clients, namespace, name);
	if (!result) {
		throw new TRPCError({ code: "NOT_FOUND", message: `Deployment '${name}' not found in '${namespace}'` });
	}
	return result;
}

export async function listDeployments(
	clients: K8sClients,
	namespace: string,
	labelSelector?: string,
): Promise<any[]> {
	try {
		const list = await clients.apps.listNamespacedDeployment({ namespace, labelSelector });
		return list.items;
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot list deployments in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function restartDeployment(
	clients: K8sClients,
	namespace: string,
	name: string,
): Promise<void> {
	const patch = {
		spec: {
			template: {
				metadata: {
					annotations: {
						"kubectl.kubernetes.io/restartedAt": new Date().toISOString(),
					},
				},
			},
		},
	};

	try {
		// Must set the strategic-merge content-type explicitly. The
		// @kubernetes/client-node v1.x default is JSON-Patch (an array of ops),
		// so a merge object is rejected with "cannot unmarshal object into
		// []jsonPatchOp". setHeaderOptions wires the Content-Type via middleware.
		await clients.apps.patchNamespacedDeployment(
			{ name, namespace, body: patch },
			setHeaderOptions("Content-Type", PatchStrategy.StrategicMergePatch),
		);
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot restart deployment '${name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function scaleDeployment(
	clients: K8sClients,
	namespace: string,
	name: string,
	replicas: number,
): Promise<void> {
	try {
		await clients.apps.patchNamespacedDeployment({ name, namespace, body: { spec: { replicas } } });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot scale deployment '${name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function getDeploymentStatus(
	clients: K8sClients,
	namespace: string,
	name: string,
): Promise<DeploymentStatus> {
	const dep = await getDeployment(clients, namespace, name);
	const s = dep.status ?? {};
	return {
		ready: s.readyReplicas ?? 0,
		available: s.availableReplicas ?? 0,
		unavailable: s.unavailableReplicas ?? 0,
		replicas: s.replicas ?? 0,
		updatedReplicas: s.updatedReplicas ?? 0,
	};
}
