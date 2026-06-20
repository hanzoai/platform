/**
 * read_running_tag — observe each cluster, write `apps.running_tag` + `health`.
 *
 * Contract: `docs/APPS_LIFECYCLE.md` §"read_running_tag — kubectl against each
 * cluster, writes running_tag + health" and §"Running state is observed, not
 * assumed … read from the cluster (kubectl image refs …). Memory files and
 * Slack messages are not authoritative." This reader is the one that turns
 * "iam claimed 1.51, actual 1.14.0" into a fact.
 *
 * Join key: the deployment's container **image repository** matched against
 * `apps.registry` (same key `read_declared_tag` uses), not the deployment name
 * — the operator names a Deployment after its CR (`cloud-api`), which can
 * differ from the app (`cloud`). The tag is recorded verbatim: a floating
 * `:main` on a running pod is stored as-is so the drift view flags the policy
 * violation.
 *
 * Health rollup (one place, here):
 *   - `green`  — desired > 0 and every desired replica is ready
 *   - `yellow` — partially ready (some replicas not yet up), or desired == 0
 *   - `red`    — desired > 0 and zero replicas ready, or no deployment found
 *
 * Multi-cluster: each apps row carries `cluster`. The platform runs inside
 * `hanzo-k8s`, so that cluster is read via the in-cluster/default kubeconfig;
 * other clusters resolve a kubeconfig from `APPS_KUBECONFIG_<CLUSTER>` (e.g.
 * `APPS_KUBECONFIG_LUX_K8S`). A cluster with no resolvable config is skipped,
 * not failed (cross-cluster config is a deliberate follow-up per the contract's
 * out-of-scope note).
 */

import { logger } from "../../lib/logger";
import { parseImageRef } from "../ci/image-ref";
import {
	createK8sClients,
	getDefaultClients,
	type K8sClients,
} from "../k8s/k8s-client";
import { listDeployments } from "../k8s/k8s-deployment";
import {
	type App,
	allApps,
	type Health,
	rollupHealth,
	upsertObserved,
} from "./shared";

/** The cluster the platform itself runs in — read via in-cluster/default config. */
const LOCAL_CLUSTER = process.env.APPS_LOCAL_CLUSTER || "hanzo-k8s";

/** `hanzo-k8s` → env var `APPS_KUBECONFIG_HANZO_K8S`. */
function kubeconfigEnvName(cluster: string): string {
	return `APPS_KUBECONFIG_${cluster.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

/**
 * Resolve K8s clients for a cluster. The local cluster uses the default
 * (in-cluster service account) config; any other cluster needs its kubeconfig
 * in the corresponding env var. Returns `null` when no config is available so
 * the caller can skip that cluster cleanly.
 */
function clientsForCluster(cluster: string): K8sClients | null {
	if (cluster === LOCAL_CLUSTER) {
		try {
			return getDefaultClients();
		} catch (err) {
			logger.warn(
				{ cluster, err: (err as Error).message },
				"[read_running_tag] default kubeconfig unavailable",
			);
			return null;
		}
	}
	const kubeconfig = process.env[kubeconfigEnvName(cluster)];
	if (!kubeconfig) {
		logger.info(
			{ cluster, env: kubeconfigEnvName(cluster) },
			"[read_running_tag] no kubeconfig for cluster, skipping",
		);
		return null;
	}
	try {
		return createK8sClients(kubeconfig);
	} catch (err) {
		logger.warn(
			{ cluster, err: (err as Error).message },
			"[read_running_tag] invalid kubeconfig for cluster",
		);
		return null;
	}
}

/** A deployment's observed state for one image repository. */
type Observed = { tag: string | null; health: Health };

/**
 * Index every deployment in a namespace by image repository. For each repo we
 * keep the image tag (first container matching the repo) and a health rollup
 * from the deployment's replica status.
 */
async function observeNamespace(
	clients: K8sClients,
	namespace: string,
): Promise<Map<string, Observed>> {
	const byRepo = new Map<string, Observed>();
	const deployments = await listDeployments(clients, namespace);

	for (const dep of deployments) {
		const containers: Array<{ image?: string }> =
			dep.spec?.template?.spec?.containers ?? [];
		const status = dep.status ?? {};
		const desired: number = dep.spec?.replicas ?? status.replicas ?? 0;
		const ready: number = status.readyReplicas ?? 0;
		const health = rollupHealth(desired, ready);

		for (const c of containers) {
			if (!c.image) continue;
			const [repository, tag] = parseImageRef(c.image);
			// First deployment seen per repository wins. A repo is normally owned
			// by exactly one deployment in a namespace.
			if (!byRepo.has(repository)) {
				byRepo.set(repository, { tag: tag || null, health });
			}
		}
	}
	return byRepo;
}

/**
 * Run one sweep: for each cluster that has apps rows, list its deployments once,
 * then write `running_tag` + `health` onto every row whose registry matches a
 * running image. Rows whose image isn't running get `running_tag = null,
 * health = red` (the contract's "(no image found)" → red drift signal).
 */
export async function readRunningTag(): Promise<{
	scanned: number;
	updated: number;
}> {
	const rows = await allApps();

	// Group rows by cluster so we hit each cluster's API once.
	const byCluster = new Map<string, App[]>();
	for (const row of rows) {
		const cluster = row.cluster ?? LOCAL_CLUSTER;
		const list = byCluster.get(cluster) ?? [];
		list.push(row);
		byCluster.set(cluster, list);
	}

	let updated = 0;
	for (const [cluster, clusterRows] of byCluster) {
		const clients = clientsForCluster(cluster);
		if (!clients) continue;

		// Cache per-namespace observations so N apps in one namespace cost one list.
		const nsCache = new Map<string, Map<string, Observed>>();
		for (const row of clusterRows) {
			const namespace = row.namespace ?? "default";
			let observed = nsCache.get(namespace);
			if (!observed) {
				try {
					observed = await observeNamespace(clients, namespace);
				} catch (err) {
					logger.warn(
						{ cluster, namespace, err: (err as Error).message },
						"[read_running_tag] list deployments failed",
					);
					observed = new Map();
				}
				nsCache.set(namespace, observed);
			}

			const hit = observed.get(row.registry);
			const patch = hit
				? { runningTag: hit.tag, health: hit.health }
				: { runningTag: null, health: "red" as Health };
			const n = await upsertObserved(row.id, patch);
			if (n > 0) updated += 1;
		}
	}

	logger.info(
		{ scanned: rows.length, clusters: byCluster.size, updated },
		"[read_running_tag] sweep done",
	);
	return { scanned: rows.length, updated };
}
