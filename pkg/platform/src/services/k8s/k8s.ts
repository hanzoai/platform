/**
 * High-level Kubernetes orchestrator.
 *
 * Composes the lower-level k8s-* modules into application-level operations.
 * Ported from: paas/platform/handlers/k8s.js
 * Uses @kubernetes/client-node v1.x request-object API.
 */

import { TRPCError } from "@trpc/server";
import {
	renderStack,
	findTemplate,
	type SubstitutionContext,
} from "../../templates/k8s/index";
import { parseAllDocuments } from "yaml";

import { createK8sClients, getDefaultClients, type K8sClients } from "./k8s-client";
import { createNamespace } from "./k8s-namespace";
import {
	createDeployment,
	deleteDeployment,
	getDeploymentStatus,
	type DeploymentSpec,
	type DeploymentStatus,
} from "./k8s-deployment";
import { deleteStatefulSet } from "./k8s-statefulset";
import { createService, deleteService } from "./k8s-service";
import { createIngress, deleteIngress } from "./k8s-ingress";
import { createHPA, deleteHPA } from "./k8s-hpa";
import { createPVC, deletePVC } from "./k8s-pvc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApplicationSpec {
	name: string;
	image: string;
	containerPort: number;
	replicas?: number;
	env?: Array<{ name: string; value: string }>;
	resources?: {
		cpuRequest?: string;
		cpuLimit?: string;
		memoryRequest?: string;
		memoryLimit?: string;
	};
	labels?: Record<string, string>;
	hosts?: string[];
	tls?: Array<{ hosts: string[]; secretName?: string }>;
	storage?: {
		mountPath: string;
		size: string;
		accessModes?: string[];
	};
	hpa?: {
		minReplicas: number;
		maxReplicas: number;
		cpuMetric?: { enabled: boolean; metricType?: string; metricValue?: number };
		memoryMetric?: { enabled: boolean; metricType?: string; metricValue?: number };
	};
}

export interface ApplicationStatus {
	deployment: DeploymentStatus | null;
	serviceExists: boolean;
	ingressExists: boolean;
	hpaExists: boolean;
}

function getClients(kubeconfig?: string): K8sClients {
	return kubeconfig ? createK8sClients(kubeconfig) : getDefaultClients();
}

// ---------------------------------------------------------------------------
// Deploy application
// ---------------------------------------------------------------------------

export async function deployApplication(
	namespace: string,
	appSpec: ApplicationSpec,
	kubeconfig?: string,
): Promise<void> {
	const clients = getClients(kubeconfig);

	if (appSpec.storage) {
		await createPVC(clients, namespace, {
			name: appSpec.name,
			size: appSpec.storage.size,
			accessModes: appSpec.storage.accessModes,
		});
	}

	await createService(clients, namespace, {
		name: appSpec.name,
		port: appSpec.containerPort,
		targetPort: appSpec.containerPort,
	});

	await createDeployment(clients, namespace, {
		name: appSpec.name,
		image: appSpec.image,
		replicas: appSpec.replicas,
		containerPort: appSpec.containerPort,
		env: appSpec.env,
		resources: appSpec.resources,
		labels: appSpec.labels,
		storage: appSpec.storage
			? { mountPath: appSpec.storage.mountPath, claimName: appSpec.name }
			: undefined,
	});

	if (appSpec.hosts && appSpec.hosts.length > 0) {
		await createIngress(clients, namespace, {
			name: `${appSpec.name}-ingress`,
			port: appSpec.containerPort,
			serviceName: appSpec.name,
			hosts: appSpec.hosts,
			tls: appSpec.tls,
		});
	}

	if (appSpec.hpa) {
		await createHPA(clients, namespace, {
			name: appSpec.name,
			targetName: appSpec.name,
			minReplicas: appSpec.hpa.minReplicas,
			maxReplicas: appSpec.hpa.maxReplicas,
			cpuMetric: appSpec.hpa.cpuMetric,
			memoryMetric: appSpec.hpa.memoryMetric,
		});
	}
}

// ---------------------------------------------------------------------------
// Deploy stack (one-click template)
// ---------------------------------------------------------------------------

export async function deployStack(
	namespace: string,
	stackName: string,
	overrides: Partial<SubstitutionContext> & { iid: string },
	kubeconfig?: string,
): Promise<void> {
	const clients = getClients(kubeconfig);
	const template = findTemplate(stackName);
	if (!template) {
		throw new TRPCError({ code: "NOT_FOUND", message: `Stack template '${stackName}' not found` });
	}

	const renderedYaml = renderStack(template, { ...overrides, namespace });
	const docs = parseAllDocuments(renderedYaml).map((doc) => doc.toJSON()).filter(Boolean);

	for (const resource of docs) {
		const kind = resource.kind;
		const resNamespace = resource.metadata?.namespace ?? namespace;

		try {
			switch (kind) {
				case "Namespace":
					await clients.core.createNamespace({ body: resource });
					break;
				case "Deployment":
					await clients.apps.createNamespacedDeployment({ namespace: resNamespace, body: resource });
					break;
				case "StatefulSet":
					await clients.apps.createNamespacedStatefulSet({ namespace: resNamespace, body: resource });
					break;
				case "CronJob":
					await clients.batch.createNamespacedCronJob({ namespace: resNamespace, body: resource });
					break;
				case "Service":
					await clients.core.createNamespacedService({ namespace: resNamespace, body: resource });
					break;
				case "PersistentVolumeClaim":
					await clients.core.createNamespacedPersistentVolumeClaim({ namespace: resNamespace, body: resource });
					break;
				case "HorizontalPodAutoscaler":
					await clients.autoscaling.createNamespacedHorizontalPodAutoscaler({ namespace: resNamespace, body: resource });
					break;
				case "Ingress":
					await clients.networking.createNamespacedIngress({ namespace: resNamespace, body: resource });
					break;
				case "Secret":
					await clients.core.createNamespacedSecret({ namespace: resNamespace, body: resource });
					break;
				case "ConfigMap":
					await clients.core.createNamespacedConfigMap({ namespace: resNamespace, body: resource });
					break;
				default:
					if (resource.apiVersion && resource.apiVersion.includes("/")) {
						const [group] = resource.apiVersion.split("/");
						const version = resource.apiVersion.split("/")[1];
						const plural = kind.toLowerCase() + "s";
						await clients.custom.createNamespacedCustomObject({
							group, version, namespace: resNamespace, plural, body: resource,
						});
					}
					break;
			}
		} catch (err) {
			const e = err as { response?: { body?: { message?: string } }; message?: string };
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Cannot apply stack resource ${kind} '${resource.metadata?.name}': ${e.response?.body?.message ?? e.message ?? String(err)}`,
			});
		}
	}
}

// ---------------------------------------------------------------------------
// Teardown application
// ---------------------------------------------------------------------------

export async function teardownApplication(
	namespace: string,
	appName: string,
	kubeconfig?: string,
): Promise<void> {
	const clients = getClients(kubeconfig);

	await deleteHPA(clients, namespace, appName);
	await deleteIngress(clients, namespace, `${appName}-ingress`);
	await deleteIngress(clients, namespace, `${appName}-subdomain`);
	await deleteIngress(clients, namespace, `${appName}-domain`);
	await deleteDeployment(clients, namespace, appName);
	await deleteStatefulSet(clients, namespace, appName);
	await deleteService(clients, namespace, appName);
	await deleteService(clients, namespace, `${appName}-headless`);
	await deletePVC(clients, namespace, appName);
}

// ---------------------------------------------------------------------------
// Application status
// ---------------------------------------------------------------------------

/**
 * Read recent pod logs for an application's pods (label-selector
 * `app=<appName>`). Returns a map of podName → log content. Each
 * pod gets `tailLines` of log output (default 200) from the
 * application's primary container.
 *
 * For long-lived streaming use the @kubernetes/client-node `Log`
 * helper directly — this is the snapshot helper for the dashboard.
 */
export async function getApplicationLogs(
	namespace: string,
	appName: string,
	options?: {
		tailLines?: number;
		container?: string;
		previous?: boolean;
		kubeconfig?: string;
	},
): Promise<Record<string, string>> {
	const clients = getClients(options?.kubeconfig);
	const tailLines = options?.tailLines ?? 200;
	const labelSelector = `app=${appName}`;

	let pods: { items?: Array<{ metadata?: { name?: string } }> };
	try {
		pods = await clients.core.listNamespacedPod({ namespace, labelSelector });
	} catch (err) {
		const e = err as { response?: { body?: { message?: string } }; message?: string };
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Cannot list pods for app '${appName}' in namespace '${namespace}': ${e.response?.body?.message ?? e.message ?? String(err)}`,
		});
	}

	const logs: Record<string, string> = {};
	for (const pod of pods.items ?? []) {
		const podName = pod.metadata?.name;
		if (!podName) continue;
		try {
			const body = await clients.core.readNamespacedPodLog({
				name: podName,
				namespace,
				container: options?.container,
				previous: options?.previous,
				tailLines,
			});
			logs[podName] = typeof body === "string" ? body : String(body);
		} catch (err) {
			const e = err as { response?: { body?: { message?: string } }; message?: string };
			logs[podName] = `[error reading logs: ${e.response?.body?.message ?? e.message ?? String(err)}]`;
		}
	}
	return logs;
}

export async function getApplicationStatus(
	namespace: string,
	appName: string,
	kubeconfig?: string,
): Promise<ApplicationStatus> {
	const clients = getClients(kubeconfig);

	let deployment: DeploymentStatus | null = null;
	try {
		deployment = await getDeploymentStatus(clients, namespace, appName);
	} catch { /* not found */ }

	let serviceExists = false;
	try {
		await clients.core.readNamespacedService({ name: appName, namespace });
		serviceExists = true;
	} catch { /* not found */ }

	let ingressExists = false;
	try {
		await clients.networking.readNamespacedIngress({ name: `${appName}-ingress`, namespace });
		ingressExists = true;
	} catch { /* not found */ }

	let hpaExists = false;
	try {
		await clients.autoscaling.readNamespacedHorizontalPodAutoscaler({ name: appName, namespace });
		hpaExists = true;
	} catch { /* not found */ }

	return { deployment, serviceExists, ingressExists, hpaExists };
}
