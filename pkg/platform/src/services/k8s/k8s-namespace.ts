/**
 * Kubernetes namespace management.
 *
 * Ported from: paas/platform/handlers/ns.js
 * Uses @kubernetes/client-node v1.x request-object API.
 */

import { TRPCError } from "@trpc/server";
import { loadManifestParsed } from "../../templates/k8s/index";
import type { K8sClients } from "./k8s-client";

function k8sError(err: unknown): string {
	const e = err as { response?: { body?: { message?: string } }; message?: string };
	return e.response?.body?.message ?? e.message ?? String(err);
}

export async function createNamespace(
	clients: K8sClients,
	name: string,
	labels?: Record<string, string>,
): Promise<void> {
	const [resource] = loadManifestParsed("namespace") as [any];
	resource.metadata.name = name;
	if (labels) {
		resource.metadata.labels = { ...resource.metadata.labels, ...labels };
	}

	try {
		await clients.core.createNamespace({ body: resource });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot create namespace '${name}': ${k8sError(err)}`,
		});
	}
}

export async function deleteNamespace(
	clients: K8sClients,
	name: string,
): Promise<void> {
	try {
		await clients.core.deleteNamespace({ name });
	} catch (err) {
		const msg = k8sError(err);
		if (msg.includes("not found")) return;
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot delete namespace '${name}': ${msg}`,
		});
	}
}

export async function listNamespaces(
	clients: K8sClients,
	labelSelector?: string,
): Promise<Array<{ name: string; labels: Record<string, string>; status: string }>> {
	try {
		const list = await clients.core.listNamespace({ labelSelector });
		return list.items.map((ns) => ({
			name: ns.metadata?.name ?? "",
			labels: (ns.metadata?.labels as Record<string, string>) ?? {},
			status: ns.status?.phase ?? "Unknown",
		}));
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot list namespaces: ${k8sError(err)}`,
		});
	}
}
