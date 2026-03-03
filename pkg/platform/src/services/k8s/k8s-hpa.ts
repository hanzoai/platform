/**
 * Kubernetes HorizontalPodAutoscaler management.
 *
 * Ported from: paas/platform/handlers/hpa.js
 * Uses @kubernetes/client-node v1.x request-object API.
 */

import { TRPCError } from "@trpc/server";
import { loadManifestParsed } from "../../templates/k8s/index";
import type { K8sClients } from "./k8s-client";

export interface HPASpec {
	name: string;
	targetName: string;
	targetKind?: "Deployment" | "StatefulSet";
	minReplicas: number;
	maxReplicas: number;
	cpuMetric?: {
		enabled: boolean;
		metricType?: string;
		metricValue?: number;
	};
	memoryMetric?: {
		enabled: boolean;
		metricType?: string;
		metricValue?: number;
	};
}

function k8sError(err: unknown): string {
	const e = err as { response?: { body?: { message?: string } }; message?: string };
	return e.response?.body?.message ?? e.message ?? String(err);
}

async function getExisting(clients: K8sClients, namespace: string, name: string): Promise<any | null> {
	try {
		return await clients.autoscaling.readNamespacedHorizontalPodAutoscaler({ name, namespace });
	} catch {
		return null;
	}
}

function buildMetrics(spec: HPASpec): any[] {
	const metrics: any[] = [];

	if (spec.cpuMetric?.enabled) {
		const metricType = spec.cpuMetric.metricType ?? "AverageUtilization";
		const targetType = metricType === "AverageUtilization" ? "Utilization" : "AverageValue";
		const targetKey = metricType === "AverageUtilization" ? "averageUtilization" : "averageValue";
		let targetValue: number | string = spec.cpuMetric.metricValue ?? 80;
		if (metricType !== "AverageUtilization" && metricType !== "AverageValueCores") {
			targetValue = `${targetValue}m`;
		}
		metrics.push({
			type: "Resource",
			resource: { name: "cpu", target: { type: targetType, [targetKey]: targetValue } },
		});
	}

	if (spec.memoryMetric?.enabled) {
		const metricType = spec.memoryMetric.metricType ?? "AverageValueMebibyte";
		const unit = metricType === "AverageValueMebibyte" ? "Mi" : "Gi";
		metrics.push({
			type: "Resource",
			resource: {
				name: "memory",
				target: { type: "AverageValue", averageValue: `${spec.memoryMetric.metricValue ?? 256}${unit}` },
			},
		});
	}

	return metrics;
}

export async function createHPA(
	clients: K8sClients,
	namespace: string,
	spec: HPASpec,
): Promise<void> {
	const metrics = buildMetrics(spec);
	if (metrics.length === 0) return;

	const [resource] = loadManifestParsed("hpa") as [any];
	resource.metadata.name = spec.name;
	resource.metadata.namespace = namespace;
	resource.spec.scaleTargetRef.apiVersion = "apps/v1";
	resource.spec.scaleTargetRef.kind = spec.targetKind ?? "Deployment";
	resource.spec.scaleTargetRef.name = spec.targetName;
	resource.spec.minReplicas = spec.minReplicas;
	resource.spec.maxReplicas = spec.maxReplicas;
	resource.spec.metrics = metrics;

	try {
		await clients.autoscaling.createNamespacedHorizontalPodAutoscaler({ namespace, body: resource });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot create HPA '${spec.name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function updateHPA(
	clients: K8sClients,
	namespace: string,
	name: string,
	spec: Partial<HPASpec>,
): Promise<void> {
	const metrics = buildMetrics(spec as HPASpec);
	if (metrics.length === 0) {
		await deleteHPA(clients, namespace, name);
		return;
	}

	const existing = await getExisting(clients, namespace, name);
	if (!existing) {
		await createHPA(clients, namespace, {
			name,
			targetName: spec.targetName ?? name,
			targetKind: spec.targetKind,
			minReplicas: spec.minReplicas ?? 1,
			maxReplicas: spec.maxReplicas ?? 5,
			cpuMetric: spec.cpuMetric,
			memoryMetric: spec.memoryMetric,
		});
		return;
	}

	if (spec.minReplicas !== undefined) existing.spec.minReplicas = spec.minReplicas;
	if (spec.maxReplicas !== undefined) existing.spec.maxReplicas = spec.maxReplicas;
	if (spec.targetName) existing.spec.scaleTargetRef.name = spec.targetName;
	existing.spec.metrics = metrics;

	try {
		await clients.autoscaling.replaceNamespacedHorizontalPodAutoscaler({ name, namespace, body: existing });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot update HPA '${name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function deleteHPA(
	clients: K8sClients,
	namespace: string,
	name: string,
): Promise<void> {
	if (!(await getExisting(clients, namespace, name))) return;
	try {
		await clients.autoscaling.deleteNamespacedHorizontalPodAutoscaler({ name, namespace });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot delete HPA '${name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function getHPA(
	clients: K8sClients,
	namespace: string,
	name: string,
): Promise<any> {
	const result = await getExisting(clients, namespace, name);
	if (!result) {
		throw new TRPCError({ code: "NOT_FOUND", message: `HPA '${name}' not found in '${namespace}'` });
	}
	return result;
}

export async function listHPAs(
	clients: K8sClients,
	namespace: string,
	labelSelector?: string,
): Promise<any[]> {
	try {
		const list = await clients.autoscaling.listNamespacedHorizontalPodAutoscaler({ namespace, labelSelector });
		return list.items;
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot list HPAs in '${namespace}': ${k8sError(err)}`,
		});
	}
}
