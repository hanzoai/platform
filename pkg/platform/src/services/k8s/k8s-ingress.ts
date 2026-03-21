/**
 * Kubernetes Ingress management.
 *
 * Ported from: paas/platform/handlers/ingress.js
 * Uses @kubernetes/client-node v1.x request-object API.
 * Supports both NGINX and Traefik ingress controllers.
 */

import { TRPCError } from "@trpc/server";
import type { K8sClients } from "./k8s-client";

export interface IngressSpec {
	name: string;
	port: number;
	serviceName: string;
	hosts: string[];
	tls?: Array<{ hosts: string[]; secretName?: string }>;
	path?: string;
	pathType?: "Prefix" | "Exact" | "ImplementationSpecific";
	ingressClass?: string;
	annotations?: Record<string, string>;
}

const NGINX_DEFAULTS: Record<string, string> = {
	"nginx.ingress.kubernetes.io/proxy-body-size": "500m",
	"nginx.ingress.kubernetes.io/proxy-connect-timeout": "6000",
	"nginx.ingress.kubernetes.io/proxy-send-timeout": "6000",
	"nginx.ingress.kubernetes.io/proxy-read-timeout": "6000",
	"nginx.ingress.kubernetes.io/proxy-next-upstream-timeout": "6000",
	"nginx.ingress.kubernetes.io/ssl-redirect": "true",
	"nginx.ingress.kubernetes.io/force-ssl-redirect": "true",
	"kubernetes.io/ingress.class": "nginx",
};

const TRAEFIK_DEFAULTS: Record<string, string> = {
	"kubernetes.io/ingress.class": "ingress",
	"traefik.ingress.kubernetes.io/router.entrypoints": "websecure",
	"traefik.ingress.kubernetes.io/router.tls": "true",
	"traefik.ingress.kubernetes.io/router.middlewares": "hanzo-security-headers@kubernetescrd",
};

function k8sError(err: unknown): string {
	const e = err as { response?: { body?: { message?: string } }; message?: string };
	return e.response?.body?.message ?? e.message ?? String(err);
}

async function getExisting(clients: K8sClients, namespace: string, name: string): Promise<any | null> {
	try {
		return await clients.networking.readNamespacedIngress({ name, namespace });
	} catch {
		return null;
	}
}

function buildAnnotations(spec: IngressSpec): Record<string, string> {
	const base = spec.ingressClass === "traefik" ? { ...TRAEFIK_DEFAULTS } : { ...NGINX_DEFAULTS };
	return { ...base, ...spec.annotations };
}

function buildIngressBody(namespace: string, spec: IngressSpec): any {
	const pathType = spec.pathType ?? "Prefix";
	const pathStr = spec.path ?? "/";

	return {
		apiVersion: "networking.k8s.io/v1",
		kind: "Ingress",
		metadata: {
			name: spec.name,
			namespace,
			annotations: buildAnnotations(spec),
		},
		spec: {
			...(spec.tls && spec.tls.length > 0 ? { tls: spec.tls } : {}),
			rules: spec.hosts.map((host) => ({
				host,
				http: {
					paths: [{
						path: pathStr,
						pathType,
						backend: { service: { name: spec.serviceName, port: { number: spec.port } } },
					}],
				},
			})),
		},
	};
}

export async function createIngress(
	clients: K8sClients,
	namespace: string,
	spec: IngressSpec,
): Promise<void> {
	const ingress = buildIngressBody(namespace, spec);
	try {
		await clients.networking.createNamespacedIngress({ namespace, body: ingress });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot create Ingress '${spec.name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function updateIngress(
	clients: K8sClients,
	namespace: string,
	name: string,
	spec: Partial<IngressSpec>,
): Promise<void> {
	const existing = await getExisting(clients, namespace, name);
	if (!existing) {
		if (!spec.port || !spec.serviceName || !spec.hosts) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Ingress '${name}' not found and full spec required for creation`,
			});
		}
		await createIngress(clients, namespace, { name, ...spec } as IngressSpec);
		return;
	}

	if (spec.port) {
		for (const rule of existing.spec.rules ?? []) {
			for (const path of rule.http?.paths ?? []) {
				path.backend.service.port.number = spec.port;
			}
		}
	}

	if (spec.hosts) {
		existing.spec.rules = spec.hosts.map((host: string) => ({
			host,
			http: {
				paths: [{
					path: spec.path ?? "/",
					pathType: spec.pathType ?? "Prefix",
					backend: {
						service: {
							name: spec.serviceName ?? existing.spec.rules?.[0]?.http?.paths?.[0]?.backend?.service?.name,
							port: { number: spec.port ?? existing.spec.rules?.[0]?.http?.paths?.[0]?.backend?.service?.port?.number },
						},
					},
				}],
			},
		}));
	}

	if (spec.tls) existing.spec.tls = spec.tls;
	if (spec.annotations) {
		existing.metadata.annotations = { ...existing.metadata.annotations, ...spec.annotations };
	}

	try {
		await clients.networking.replaceNamespacedIngress({ name, namespace, body: existing });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot update Ingress '${name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function deleteIngress(
	clients: K8sClients,
	namespace: string,
	name: string,
): Promise<void> {
	if (!(await getExisting(clients, namespace, name))) return;
	try {
		await clients.networking.deleteNamespacedIngress({ name, namespace });
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot delete Ingress '${name}' in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function getIngress(
	clients: K8sClients,
	namespace: string,
	name: string,
): Promise<any> {
	const result = await getExisting(clients, namespace, name);
	if (!result) {
		throw new TRPCError({ code: "NOT_FOUND", message: `Ingress '${name}' not found in '${namespace}'` });
	}
	return result;
}

export async function listIngresses(
	clients: K8sClients,
	namespace: string,
	labelSelector?: string,
): Promise<any[]> {
	try {
		const list = await clients.networking.listNamespacedIngress({ namespace, labelSelector });
		return list.items;
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot list Ingresses in '${namespace}': ${k8sError(err)}`,
		});
	}
}

export async function createSubdomainIngress(
	clients: K8sClients,
	namespace: string,
	name: string,
	port: number,
	domains: string[],
): Promise<void> {
	const hosts = domains.map((d) => `${name}-${namespace}.${d}`);
	const tls = domains.map((d) => ({ hosts: [`${name}-${namespace}.${d}`] }));

	await createIngress(clients, namespace, {
		name: `${name}-subdomain`,
		port,
		serviceName: name,
		hosts,
		tls,
	});
}

export async function createCustomDomainIngress(
	clients: K8sClients,
	namespace: string,
	name: string,
	port: number,
	domain: string,
	certSecret: string,
): Promise<void> {
	const isWildcard = domain.startsWith("*");
	const hosts = [domain];

	const parts = domain.split(".");
	const isRootDomain = !isWildcard && parts.length === 2;
	if (isRootDomain) hosts.push(`www.${domain}`);

	const annotations: Record<string, string> = {};
	if (isWildcard) {
		annotations["cert-manager.io/issuer"] = name;
	} else {
		annotations["cert-manager.io/cluster-issuer"] = "hanzo-http01";
	}

	await createIngress(clients, namespace, {
		name: `${name}-domain`,
		port,
		serviceName: name,
		hosts,
		tls: [{ hosts, secretName: certSecret }],
		annotations,
	});
}
