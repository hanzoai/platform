/**
 * Kubernetes PersistentVolumeClaim management.
 *
 * Ported from: paas/platform/handlers/pvc.js
 * Uses @kubernetes/client-node v1.x request-object API.
 */

import { TRPCError } from "@trpc/server";
import { loadManifestParsed } from "../../templates/k8s/index";
import type { K8sClients } from "./k8s-client";

export interface PVCSpec {
	name: string;
	size: string;
	accessModes?: string[];
}

function k8sError(err: unknown): string {
	const e = err as { response?: { body?: { message?: string } }; message?: string };
	return e.response?.body?.message ?? e.message ?? String(err);
}

async function getExisting(clients: K8sClients, namespace: string, name: string): Promise<any | null> {
	try {
		return await clients.core.readNamespacedPersistentVolumeClaim({ name, namespace });
	} catch {
		return null;
	}
}

export async function createPVC(
	clients: K8sClients,
	namespace: string,
	spec: PVCSpec,
): Promise<void> {
	const [resource] = loadManifestParsed("pvc") as [any];
	resource.metadata.name = spec.name;
	resource.metadata.namespace = namespace;
	resource.spec.accessModes = spec.accessModes ?? ["ReadWriteOnce"];
	resource.spec.resources.requests.storage = spec.size;

	try {
		await clients.core.createNamespacedPersistentVolumeClaim({ namespace, body: resource });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot create PVC '${spec.name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function deletePVC(
	clients: K8sClients,
	namespace: string,
	name: string,
): Promise<void> {
	if (!(await getExisting(clients, namespace, name))) return;
	try {
		await clients.core.deleteNamespacedPersistentVolumeClaim({ name, namespace });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot delete PVC '${name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function getPVC(
	clients: K8sClients,
	namespace: string,
	name: string,
): Promise<any> {
	const result = await getExisting(clients, namespace, name);
	if (!result) {
		throw new TRPCError({ code: "NOT_FOUND", message: `PVC '${name}' not found in '${namespace}'` });
	}
	return result;
}

export async function listPVCs(
	clients: K8sClients,
	namespace: string,
	labelSelector?: string,
): Promise<any[]> {
	try {
		const list = await clients.core.listNamespacedPersistentVolumeClaim({ namespace, labelSelector });
		return list.items;
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot list PVCs in '${namespace}': ${k8sError(err)}`,
		});
	}
}
