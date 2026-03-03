/**
 * Kubernetes CronJob management.
 *
 * Ported from: paas/platform/handlers/cronjob.js
 * Uses @kubernetes/client-node v1.x request-object API.
 */

import { TRPCError } from "@trpc/server";
import { loadManifestParsed } from "../../templates/k8s/index";
import type { K8sClients } from "./k8s-client";

export interface CronJobSpec {
	name: string;
	image: string;
	schedule: string;
	timeZone?: string;
	concurrencyPolicy?: string;
	suspend?: boolean;
	successfulJobsHistoryLimit?: number;
	failedJobsHistoryLimit?: number;
	containerPort?: number;
	restartPolicy?: string;
	resources?: {
		cpuRequest?: string;
		cpuLimit?: string;
		memoryRequest?: string;
		memoryLimit?: string;
	};
	env?: Array<{ name: string; value: string }>;
	labels?: Record<string, string>;
	storage?: {
		mountPath: string;
		claimName: string;
	};
}

function k8sError(err: unknown): string {
	const e = err as { response?: { body?: { message?: string } }; message?: string };
	return e.response?.body?.message ?? e.message ?? String(err);
}

async function getExisting(clients: K8sClients, namespace: string, name: string): Promise<any | null> {
	try {
		return await clients.batch.readNamespacedCronJob({ name, namespace });
	} catch {
		return null;
	}
}

export async function createCronJob(
	clients: K8sClients,
	namespace: string,
	spec: CronJobSpec,
): Promise<void> {
	const [resource] = loadManifestParsed("cronjob") as [any];
	const { metadata } = resource;
	const cSpec = resource.spec;

	metadata.name = spec.name;
	metadata.namespace = namespace;
	cSpec.schedule = spec.schedule;
	if (spec.timeZone) cSpec.timeZone = spec.timeZone;
	if (spec.concurrencyPolicy) cSpec.concurrencyPolicy = spec.concurrencyPolicy;
	if (spec.suspend !== undefined) cSpec.suspend = spec.suspend;
	if (spec.successfulJobsHistoryLimit !== undefined) cSpec.successfulJobsHistoryLimit = spec.successfulJobsHistoryLimit;
	if (spec.failedJobsHistoryLimit !== undefined) cSpec.failedJobsHistoryLimit = spec.failedJobsHistoryLimit;

	const jobSpec = cSpec.jobTemplate.spec.template.spec;
	if (spec.restartPolicy) jobSpec.restartPolicy = spec.restartPolicy;

	const container = jobSpec.containers[0];
	container.name = spec.name;
	container.image = spec.image;

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

	if (spec.storage) {
		container.volumeMounts = [{ name: "storage", mountPath: spec.storage.mountPath }];
		jobSpec.volumes = [{ name: "storage", persistentVolumeClaim: { claimName: spec.storage.claimName } }];
	} else {
		delete container.volumeMounts;
		delete jobSpec.volumes;
	}

	try {
		await clients.batch.createNamespacedCronJob({ namespace, body: resource });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot create CronJob '${spec.name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function updateCronJob(
	clients: K8sClients,
	namespace: string,
	name: string,
	spec: Partial<CronJobSpec>,
): Promise<void> {
	const existing = await getExisting(clients, namespace, name);
	if (!existing) {
		throw new TRPCError({ code: "NOT_FOUND", message: `CronJob '${name}' not found in '${namespace}'` });
	}

	const cSpec = existing.spec;
	if (spec.schedule) cSpec.schedule = spec.schedule;
	if (spec.timeZone) cSpec.timeZone = spec.timeZone;
	if (spec.concurrencyPolicy) cSpec.concurrencyPolicy = spec.concurrencyPolicy;
	if (spec.suspend !== undefined) cSpec.suspend = spec.suspend;
	if (spec.successfulJobsHistoryLimit !== undefined) cSpec.successfulJobsHistoryLimit = spec.successfulJobsHistoryLimit;
	if (spec.failedJobsHistoryLimit !== undefined) cSpec.failedJobsHistoryLimit = spec.failedJobsHistoryLimit;

	const container = cSpec.jobTemplate.spec.template.spec.containers[0];
	if (spec.image) container.image = spec.image;
	if (spec.resources) {
		if (spec.resources.cpuRequest) container.resources.requests.cpu = spec.resources.cpuRequest;
		if (spec.resources.memoryRequest) container.resources.requests.memory = spec.resources.memoryRequest;
		if (spec.resources.cpuLimit) container.resources.limits.cpu = spec.resources.cpuLimit;
		if (spec.resources.memoryLimit) container.resources.limits.memory = spec.resources.memoryLimit;
	}
	if (spec.env) {
		container.env = [
			{ name: "HANZO_NAMESPACE", value: namespace },
			{ name: "HANZO_CONTAINER_IID", value: name },
			...spec.env,
		];
	}

	try {
		await clients.batch.replaceNamespacedCronJob({ name, namespace, body: existing });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot update CronJob '${name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function deleteCronJob(
	clients: K8sClients,
	namespace: string,
	name: string,
): Promise<void> {
	if (!(await getExisting(clients, namespace, name))) return;
	try {
		await clients.batch.deleteNamespacedCronJob({ name, namespace });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot delete CronJob '${name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function getCronJob(
	clients: K8sClients,
	namespace: string,
	name: string,
): Promise<any> {
	const result = await getExisting(clients, namespace, name);
	if (!result) {
		throw new TRPCError({ code: "NOT_FOUND", message: `CronJob '${name}' not found in '${namespace}'` });
	}
	return result;
}

export async function listCronJobs(
	clients: K8sClients,
	namespace: string,
	labelSelector?: string,
): Promise<any[]> {
	try {
		const list = await clients.batch.listNamespacedCronJob({ namespace, labelSelector });
		return list.items;
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot list CronJobs in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function triggerCronJob(
	clients: K8sClients,
	namespace: string,
	name: string,
): Promise<string> {
	const cronJob = await getCronJob(clients, namespace, name);
	const jobName = `${name}-manual-${Date.now()}`;

	const job = {
		apiVersion: "batch/v1",
		kind: "Job",
		metadata: {
			name: jobName,
			namespace,
			labels: { app: name, "triggered-by": "hanzo-platform" },
		},
		spec: cronJob.spec.jobTemplate.spec,
	};

	try {
		await clients.batch.createNamespacedJob({ namespace, body: job as any });
		return jobName;
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot trigger Job from CronJob '${name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}
