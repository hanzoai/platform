/**
 * Kubernetes Service management.
 *
 * Ported from: paas/platform/handlers/service.js
 * Uses @kubernetes/client-node v1.x request-object API.
 */

import { TRPCError } from "@trpc/server";
import { loadManifestParsed } from "../../templates/k8s/index";
import type { K8sClients } from "./k8s-client";

export interface ServiceSpec {
	name: string;
	port: number;
	targetPort: number;
	selectorApp?: string;
	type?: "ClusterIP" | "NodePort" | "LoadBalancer";
	headless?: boolean;
}

function k8sError(err: unknown): string {
	const e = err as { response?: { body?: { message?: string } }; message?: string };
	return e.response?.body?.message ?? e.message ?? String(err);
}

async function getExisting(clients: K8sClients, namespace: string, name: string): Promise<any | null> {
	try {
		return await clients.core.readNamespacedService({ name, namespace });
	} catch {
		return null;
	}
}

export async function createService(
	clients: K8sClients,
	namespace: string,
	spec: ServiceSpec,
): Promise<void> {
	const [resource] = loadManifestParsed("service") as [any];
	const { metadata } = resource;
	const sSpec = resource.spec;

	metadata.name = spec.name;
	metadata.namespace = namespace;

	if (spec.headless) {
		sSpec.clusterIP = "None";
		delete sSpec.type;
	} else if (spec.type) {
		sSpec.type = spec.type;
	}

	sSpec.selector.app = spec.selectorApp ?? spec.name;
	sSpec.ports[0].port = spec.port;
	sSpec.ports[0].targetPort = spec.targetPort;

	try {
		await clients.core.createNamespacedService({ namespace, body: resource });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot create Service '${spec.name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function updateService(
	clients: K8sClients,
	namespace: string,
	name: string,
	spec: Partial<ServiceSpec>,
): Promise<void> {
	const existing = await getExisting(clients, namespace, name);
	if (!existing) {
		if (spec.port === undefined || spec.targetPort === undefined) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Service '${name}' not found and port/targetPort required for creation`,
			});
		}
		await createService(clients, namespace, {
			name,
			port: spec.port,
			targetPort: spec.targetPort,
			selectorApp: spec.selectorApp,
			type: spec.type,
			headless: spec.headless,
		});
		return;
	}

	const sSpec = existing.spec;
	if (spec.selectorApp) sSpec.selector.app = spec.selectorApp;
	if (spec.port !== undefined) sSpec.ports[0].port = spec.port;
	if (spec.targetPort !== undefined) sSpec.ports[0].targetPort = spec.targetPort;

	try {
		await clients.core.replaceNamespacedService({ name, namespace, body: existing });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot update Service '${name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function deleteService(
	clients: K8sClients,
	namespace: string,
	name: string,
): Promise<void> {
	if (!(await getExisting(clients, namespace, name))) return;
	try {
		await clients.core.deleteNamespacedService({ name, namespace });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot delete Service '${name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function getService(
	clients: K8sClients,
	namespace: string,
	name: string,
): Promise<any> {
	const result = await getExisting(clients, namespace, name);
	if (!result) {
		throw new TRPCError({ code: "NOT_FOUND", message: `Service '${name}' not found in '${namespace}'` });
	}
	return result;
}

export async function listServices(
	clients: K8sClients,
	namespace: string,
	labelSelector?: string,
): Promise<any[]> {
	try {
		const list = await clients.core.listNamespacedService({ namespace, labelSelector });
		return list.items;
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot list Services in '${namespace}': ${k8sError(err)}`,
		});
	}
}
