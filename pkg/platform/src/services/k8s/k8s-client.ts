/**
 * Kubernetes client factory.
 *
 * Creates typed API clients from a kubeconfig string (multi-cluster) or
 * from the default kubeconfig on the host.
 *
 * Uses @kubernetes/client-node v1.x which takes request objects and
 * returns response bodies directly.
 *
 * Ported from: paas/platform/handlers/*.js
 */

import * as k8s from "@kubernetes/client-node";

// ---------------------------------------------------------------------------
// Client bundle type
// ---------------------------------------------------------------------------

export interface K8sClients {
	/** CoreV1Api -- pods, services, secrets, configmaps, namespaces, PVCs */
	core: k8s.CoreV1Api;
	/** AppsV1Api -- deployments, statefulsets, daemonsets */
	apps: k8s.AppsV1Api;
	/** BatchV1Api -- jobs, cronjobs */
	batch: k8s.BatchV1Api;
	/** NetworkingV1Api -- ingresses, network policies */
	networking: k8s.NetworkingV1Api;
	/** AutoscalingV2Api -- HPAs */
	autoscaling: k8s.AutoscalingV2Api;
	/** RbacAuthorizationV1Api -- roles, rolebindings, clusterroles */
	rbac: k8s.RbacAuthorizationV1Api;
	/** CustomObjectsApi -- operator CRs, cert-manager, etc. */
	custom: k8s.CustomObjectsApi;
	/** The underlying KubeConfig for advanced use */
	kc: k8s.KubeConfig;
}

// ---------------------------------------------------------------------------
// Factory: from kubeconfig YAML string
// ---------------------------------------------------------------------------

/**
 * Create a full set of K8s API clients from a kubeconfig YAML string.
 */
export function createK8sClients(kubeconfig: string): K8sClients {
	const kc = new k8s.KubeConfig();
	kc.loadFromString(kubeconfig);
	return buildClients(kc);
}

// ---------------------------------------------------------------------------
// Factory: from default kubeconfig
// ---------------------------------------------------------------------------

/**
 * Create a full set of K8s API clients from the default kubeconfig.
 */
export function getDefaultClients(): K8sClients {
	const kc = new k8s.KubeConfig();
	kc.loadFromDefault();
	return buildClients(kc);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function buildClients(kc: k8s.KubeConfig): K8sClients {
	return {
		core: kc.makeApiClient(k8s.CoreV1Api),
		apps: kc.makeApiClient(k8s.AppsV1Api),
		batch: kc.makeApiClient(k8s.BatchV1Api),
		networking: kc.makeApiClient(k8s.NetworkingV1Api),
		autoscaling: kc.makeApiClient(k8s.AutoscalingV2Api),
		rbac: kc.makeApiClient(k8s.RbacAuthorizationV1Api),
		custom: kc.makeApiClient(k8s.CustomObjectsApi),
		kc,
	};
}
