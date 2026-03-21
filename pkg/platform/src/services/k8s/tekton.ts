/**
 * Tekton pipeline management.
 *
 * Ported from: paas/platform/handlers/tekton.js
 * Uses @kubernetes/client-node v1.x request-object API.
 */

import { randomBytes, createHash } from "node:crypto";
import * as k8s from "@kubernetes/client-node";
import { TRPCError } from "@trpc/server";
import { loadManifest } from "../../templates/k8s/index";
import type { K8sClients } from "./k8s-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TektonContainer {
	iid: string;
	slug: string;
	type: "deployment" | "statefulset" | "cronjob";
	repo: {
		connected: boolean;
		type: "github" | "gitlab" | "bitbucket";
		url: string;
		branch: string;
		path: string;
		watchPath?: string;
		dockerfile: string;
		webHookId?: string | number;
		name?: string;
		repoId?: string;
		testImage?: string;
		testEnabled?: boolean;
		testCommand?: string;
	};
}

export interface TektonEnvironment {
	iid: string;
}

export interface TektonGitProvider {
	provider: "github" | "gitlab" | "bitbucket";
	accessToken: string;
}

export interface TektonClusterInfo {
	domains: string[];
	reverseProxyURL?: string;
	ips?: string[];
}

export interface PipelineRunStatus {
	name: string;
	status: string;
	startTime?: string;
	completionTime?: string;
	conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEKTON_NAMESPACE = process.env.TEKTON_NAMESPACE ?? "tekton-builds";
const TEKTON_TRIGGERS_GROUP = "triggers.tekton.dev";
const TEKTON_TRIGGERS_VERSION = "v1beta1";
const TEKTON_GROUP = "tekton.dev";
const TEKTON_VERSION = "v1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function k8sError(err: unknown): string {
	const e = err as { response?: { body?: { message?: string } }; message?: string };
	return e.response?.body?.message ?? e.message ?? String(err);
}

function formatKind(type: string): string {
	if (type === "deployment") return "Deployment";
	if (type === "statefulset") return "StatefulSet";
	return "CronJob";
}

function resolveTestImage(dockerfile?: string): string {
	if (!dockerfile) return "node:22-alpine";
	const lower = dockerfile.toLowerCase();
	if (lower.includes("go") || lower.includes("golang")) return "golang:1.23-alpine";
	if (lower.includes("python")) return "python:3.12-alpine";
	if (lower.includes("rust")) return "rust:1.83-alpine";
	return "node:22-alpine";
}

// ---------------------------------------------------------------------------
// Pipeline creation
// ---------------------------------------------------------------------------

export async function createTektonPipeline(
	clients: K8sClients,
	container: TektonContainer,
	environment: TektonEnvironment,
	gitProvider: TektonGitProvider,
	clusterInfo: TektonClusterInfo,
): Promise<void> {
	if (!container.repo?.connected || !gitProvider) return;

	const { repo } = container;
	const namespace = environment.iid;
	const pipelineId = container.slug;
	const appKind = formatKind(container.type);
	const appName = container.iid;
	const testImage = repo.testImage ?? resolveTestImage(repo.dockerfile);
	const testEnabled = repo.testEnabled !== false ? "true" : "false";
	const testCommand = repo.testCommand ?? "";

	const manifest = loadManifest(`${repo.type}-pipeline` as any);
	const resources = k8s.loadAllYaml(manifest);
	const suffix = `-${pipelineId}`;

	for (const resource of resources) {
		try {
			const { kind, metadata } = resource;
			const resNs = metadata.namespace ?? TEKTON_NAMESPACE;
			metadata.name += suffix;

			switch (kind) {
				case "ServiceAccount":
					await clients.core.createNamespacedServiceAccount({ namespace: resNs, body: resource });
					break;

				case "Secret": {
					const secretToken = randomBytes(20).toString("hex");
					resource.stringData.secretToken = secretToken;
					await clients.core.createNamespacedSecret({ namespace: resNs, body: resource });
					break;
				}

				case "ClusterRoleBinding":
					resource.subjects[0].name += suffix;
					await clients.rbac.createClusterRoleBinding({ body: resource });
					break;

				case "RoleBinding":
					resource.subjects[0].name += suffix;
					await clients.rbac.createNamespacedRoleBinding({ namespace: resNs, body: resource });
					break;

				case "Ingress": {
					resource.spec.rules[0].http.paths[0].path = `/tekton-${pipelineId}(/|$)(.*)`;
					resource.spec.rules[0].http.paths[0].backend.service.name += suffix;

					if (clusterInfo.domains.length > 0) {
						resource.metadata.annotations["kubernetes.io/ingress.class"] = "ingress";
						resource.spec.tls = clusterInfo.domains.map((d: string) => ({ hosts: [d] }));
						for (const domain of clusterInfo.domains) {
							resource.spec.rules.unshift({
								host: domain,
								http: {
									paths: [{
										path: `/tekton-${pipelineId}(/|$)(.*)`,
										pathType: "ImplementationSpecific",
										backend: {
											service: {
												name: `el-${repo.type}-listener-${pipelineId}`,
												port: { number: 8080 },
											},
										},
									}],
								},
							});
						}
					}

					await clients.networking.createNamespacedIngress({ namespace: resNs, body: resource });
					break;
				}

				case "EventListener": {
					const trigger = resource.spec.triggers[0];
					trigger.interceptors[0].params[0].value.secretName += suffix;

					if (gitProvider.provider === "bitbucket") {
						trigger.interceptors[1].params[0].value =
							`body.push.changes[0].new.name == '${repo.branch}'`;
					} else {
						trigger.interceptors[1].params[0].value =
							`body.ref == 'refs/heads/${repo.branch}'`;
					}

					trigger.bindings[0].ref += suffix;
					trigger.template.ref += suffix;
					resource.spec.resources.kubernetesResource.spec.template.spec.serviceAccountName += suffix;

					await clients.custom.createNamespacedCustomObject({
						group: TEKTON_TRIGGERS_GROUP,
						version: TEKTON_TRIGGERS_VERSION,
						namespace: resNs,
						plural: "eventlisteners",
						body: resource,
					});
					break;
				}

				case "TriggerBinding": {
					const params = resource.spec.params;
					params[0].value = appKind;
					params[1].value = appName;
					params[2].value = TEKTON_NAMESPACE;
					params[3].value = namespace;
					params[4].value = `registry.${TEKTON_NAMESPACE}:5000`;
					params[5].value = gitProvider.accessToken;
					params[6].value = repo.branch;
					params[7].value = repo.path.replace(/^\/+/, "");
					params[8].value = (repo.watchPath ?? repo.path).replace(/^\/+/, "");
					params[9].value = container.slug;
					params[10].value = repo.dockerfile.replace(/^\/+/, "");
					params[11].value = testImage;
					params[12].value = testEnabled;
					params[13].value = testCommand;

					await clients.custom.createNamespacedCustomObject({
						group: TEKTON_TRIGGERS_GROUP,
						version: TEKTON_TRIGGERS_VERSION,
						namespace: resNs,
						plural: "triggerbindings",
						body: resource,
					});
					break;
				}

				case "TriggerTemplate":
					resource.spec.resourcetemplates[0].spec.serviceAccountName += suffix;
					await clients.custom.createNamespacedCustomObject({
						group: TEKTON_TRIGGERS_GROUP,
						version: TEKTON_TRIGGERS_VERSION,
						namespace: resNs,
						plural: "triggertemplates",
						body: resource,
					});
					break;

				default:
					break;
			}
		} catch (err) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Cannot create Tekton resource ${resource.kind} '${resource.metadata.name}': ${k8sError(err)}`,
			});
		}
	}
}

// ---------------------------------------------------------------------------
// Pipeline deletion
// ---------------------------------------------------------------------------

export async function deleteTektonPipeline(
	clients: K8sClients,
	container: TektonContainer,
	gitProvider: TektonGitProvider | null,
): Promise<void> {
	if (!container.repo?.connected || !gitProvider) return;

	const { repo } = container;
	const pipelineId = container.slug;
	const manifest = loadManifest(`${repo.type}-pipeline` as any);
	const resources = k8s.loadAllYaml(manifest);
	const suffix = `-${pipelineId}`;

	for (const resource of resources) {
		try {
			const { kind, metadata } = resource;
			const resNs = metadata.namespace ?? TEKTON_NAMESPACE;
			metadata.name += suffix;

			switch (kind) {
				case "ServiceAccount":
					await clients.core.deleteNamespacedServiceAccount({ name: metadata.name, namespace: resNs });
					break;
				case "Secret":
					await clients.core.deleteNamespacedSecret({ name: metadata.name, namespace: resNs });
					break;
				case "ClusterRoleBinding":
					await clients.rbac.deleteClusterRoleBinding({ name: metadata.name });
					break;
				case "RoleBinding":
					await clients.rbac.deleteNamespacedRoleBinding({ name: metadata.name, namespace: resNs });
					break;
				case "Ingress":
					await clients.networking.deleteNamespacedIngress({ name: metadata.name, namespace: resNs });
					break;
				case "EventListener":
					await clients.custom.deleteNamespacedCustomObject({
						group: TEKTON_TRIGGERS_GROUP, version: TEKTON_TRIGGERS_VERSION,
						namespace: resNs, plural: "eventlisteners", name: metadata.name,
					});
					break;
				case "TriggerBinding":
					await clients.custom.deleteNamespacedCustomObject({
						group: TEKTON_TRIGGERS_GROUP, version: TEKTON_TRIGGERS_VERSION,
						namespace: resNs, plural: "triggerbindings", name: metadata.name,
					});
					break;
				case "TriggerTemplate":
					await clients.custom.deleteNamespacedCustomObject({
						group: TEKTON_TRIGGERS_GROUP, version: TEKTON_TRIGGERS_VERSION,
						namespace: resNs, plural: "triggertemplates", name: metadata.name,
					});
					break;
				default:
					break;
			}
		} catch {
			// Best-effort deletion
		}
	}
}

// ---------------------------------------------------------------------------
// Pipeline run status
// ---------------------------------------------------------------------------

export async function getPipelineRunStatus(
	clients: K8sClients,
	taskRunName: string,
): Promise<PipelineRunStatus | null> {
	try {
		const body: any = await clients.custom.getNamespacedCustomObject({
			group: TEKTON_GROUP, version: TEKTON_VERSION,
			namespace: TEKTON_NAMESPACE, plural: "taskruns", name: taskRunName,
		});

		return {
			name: body.metadata.name,
			status: body.status?.conditions?.[0]?.reason ?? "Unknown",
			startTime: body.status?.startTime,
			completionTime: body.status?.completionTime,
			conditions: body.status?.conditions,
		};
	} catch {
		return null;
	}
}

export async function listPipelineRuns(
	clients: K8sClients,
	labelSelector?: string,
): Promise<PipelineRunStatus[]> {
	try {
		const body: any = await clients.custom.listNamespacedCustomObject({
			group: TEKTON_GROUP, version: TEKTON_VERSION,
			namespace: TEKTON_NAMESPACE, plural: "taskruns",
			labelSelector,
		});

		return (body.items ?? []).map((item: any) => ({
			name: item.metadata.name,
			status: item.status?.conditions?.[0]?.reason ?? "Unknown",
			startTime: item.status?.startTime,
			completionTime: item.status?.completionTime,
			conditions: item.status?.conditions,
		}));
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot list pipeline runs: ${k8sError(err)}`,
		});
	}
}

export async function triggerManualPipelineRun(
	clients: K8sClients,
	container: TektonContainer,
	environment: TektonEnvironment,
	gitProvider: TektonGitProvider,
): Promise<string> {
	if (!container.repo?.connected || !gitProvider) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Cannot trigger pipeline: repo not connected or no git provider",
		});
	}

	const pipelineId = container.slug;
	const generatedCommitId = createHash("sha1")
		.update(`${new Date().toISOString()}${Math.random()}`)
		.digest("hex");

	const taskRunName = `${pipelineId}-manual-${Date.now()}`;
	const taskRun = {
		apiVersion: "tekton.dev/v1",
		kind: "TaskRun",
		metadata: {
			name: taskRunName,
			namespace: TEKTON_NAMESPACE,
			labels: {
				"triggers.tekton.dev/eventlistener": `${container.repo.type}-listener-${pipelineId}`,
				"hanzo.ai/triggered-by": "manual",
			},
		},
		spec: {
			serviceAccountName: `pipeline-account-${pipelineId}`,
			params: [
				{ name: "kind", value: formatKind(container.type) },
				{ name: "resourcename", value: container.iid },
				{ name: "namespace", value: TEKTON_NAMESPACE },
				{ name: "resourcenamespace", value: environment.iid },
				{ name: "gitrevision", value: generatedCommitId },
				{ name: "gitrepositoryurl", value: container.repo.url },
			],
		},
	};

	try {
		await clients.custom.createNamespacedCustomObject({
			group: TEKTON_GROUP, version: TEKTON_VERSION,
			namespace: TEKTON_NAMESPACE, plural: "taskruns",
			body: taskRun,
		});
		return taskRunName;
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot trigger manual pipeline run: ${k8sError(err)}`,
		});
	}
}

export async function cancelPipelineRun(
	clients: K8sClients,
	taskRunName: string,
): Promise<void> {
	try {
		await clients.custom.patchNamespacedCustomObject({
			group: TEKTON_GROUP, version: TEKTON_VERSION,
			namespace: TEKTON_NAMESPACE, plural: "taskruns", name: taskRunName,
			body: { spec: { status: "TaskRunCancelled" } },
		});
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot cancel pipeline run '${taskRunName}': ${k8sError(err)}`,
		});
	}
}

export async function deletePipelineRun(
	clients: K8sClients,
	taskRunName: string,
): Promise<void> {
	try {
		await clients.custom.deleteNamespacedCustomObject({
			group: TEKTON_GROUP, version: TEKTON_VERSION,
			namespace: TEKTON_NAMESPACE, plural: "taskruns", name: taskRunName,
		});
	} catch {
		// Idempotent
	}
}
