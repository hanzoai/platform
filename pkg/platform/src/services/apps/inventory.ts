/**
 * Live apps inventory — the "observe" reader of the control plane
 * (`docs/APPS_LIFECYCLE.md` §1, readers `read_declared_tag` + `read_running_tag`,
 * unified into one cluster pass).
 *
 * The platform pod runs in-cluster as `hanzo-paas-sa`, whose ClusterRole grants
 * `hanzo.ai/services` (list) and `apps/deployments` + `pods` (list/get). This
 * module uses that access to reconcile the `apps` table from REALITY:
 *
 *   - `declaredTag`  ← the operator `Service` CR's `spec.image.tag`
 *                      (what SHOULD run — the declared-state source of truth).
 *   - `runningTag`   ← the live `Deployment`'s container image tag
 *                      (what ACTUALLY runs).
 *   - `health`       ← rolled up from the Deployment's ready/desired replicas.
 *
 * It is READ-MOSTLY: it lists CRs + Deployments and writes ONLY to platform's
 * own SQLite `apps` table. It NEVER mutates a cluster object, so it cannot
 * affect the control plane or the live services it observes. The lifecycle
 * WRITE path (patching a `Service` CR to a new tag) lives in the CI deploy
 * executor and is intentionally not invoked here.
 *
 * `latestTag` / `releaseUrl` / `releaseAssets` are owned by the GHCR/GH-release
 * reader (a follow-up); this sync never clobbers those columns.
 *
 * One way to populate the table: this module. The static `db/seed.ts` is a
 * bootstrap fallback for offline/dev; at runtime the scheduler
 * (`inventory-scheduler.ts`) drives this every interval.
 */

import { db, eq } from "@hanzo/platform/db";
import {
	type NewApp,
	appEnvValues,
	appHealthValues,
	apps,
	organization,
} from "@hanzo/platform/db/schema";
import { parseImageRef } from "../ci/image-ref";

// Env / health vocabularies derive from the single canonical source — the
// `appEnvValues` / `appHealthValues` `as const` tuples the schema column enums
// are built from — so they cannot drift out of sync with the DB. (The
// `apps-api` read layer derives the same two types the same way.)
/** Deployment env vocabulary (`"dev" | "test" | "main"`). */
export type AppEnv = (typeof appEnvValues)[number];
/** Aggregate health vocabulary (`"green" | "yellow" | "red"`). */
export type AppHealth = (typeof appHealthValues)[number];
import {
	getDefaultClients,
	createK8sClients,
	type K8sClients,
} from "../k8s/k8s-client";

const OPERATOR_GROUP = "hanzo.ai";
const OPERATOR_VERSION = "v1";
const SERVICES_PLURAL = "services";

/**
 * The clusters + namespaces this platform install observes, and the env each
 * namespace maps to. hanzo-k8s is the shared platform cluster: the `hanzo`
 * namespace is production (`main`); the env-split namespaces map to test/dev
 * (Hanzo 3-env split — `svc.{testnet,devnet}.hanzo.ai`).
 *
 * Cross-cluster federation (lux-k8s / zoo-k8s) is added by appending entries
 * here whose `kubeconfig` is loaded from KMS — see the report. The default
 * (in-cluster) target needs no kubeconfig.
 */
export interface ClusterTarget {
	/** Logical cluster name recorded on each app row, e.g. `hanzo-k8s`. */
	cluster: string;
	/** Namespace → env map (only listed namespaces are scanned). */
	namespaces: Record<string, AppEnv>;
	/** Optional kubeconfig YAML for a remote cluster; omit for in-cluster. */
	kubeconfig?: string;
}

/** Default target: the in-cluster hanzo-k8s, all three Hanzo env namespaces. */
export const DEFAULT_TARGETS: ClusterTarget[] = [
	{
		cluster: "hanzo-k8s",
		namespaces: { hanzo: "main", "hanzo-testnet": "test", "hanzo-devnet": "dev" },
	},
];

// ---------------------------------------------------------------------------
// Wire shapes (only the fields we read; the operator CR is much larger)
// ---------------------------------------------------------------------------

interface ServiceCR {
	metadata?: { name?: string };
	spec?: {
		image?: { repository?: string; tag?: string };
	};
}

interface DeploymentLike {
	spec?: {
		replicas?: number;
		template?: { spec?: { containers?: Array<{ image?: string }> } };
	};
	status?: {
		readyReplicas?: number;
		replicas?: number;
		availableReplicas?: number;
	};
}

// ---------------------------------------------------------------------------
// Pure mapping helpers (unit-tested without a cluster)
// ---------------------------------------------------------------------------

/**
 * Derive the image namespace ("org" in apps-table terms) from an image repo.
 * `ghcr.io/hanzoai/chat` → `hanzoai`; `docker.io/grafana/grafana` → `grafana`.
 * Falls back to the whole repo when it has no namespace segment.
 */
export function orgFromRepository(repository: string): string {
	const parts = repository.split("/").filter(Boolean);
	// [registryHost, namespace, name, ...] → namespace is parts[1]; if there is
	// no registry host (`namespace/name`), it is parts[0].
	if (parts.length >= 3) return parts[1]!;
	if (parts.length === 2) return parts[0]!;
	return repository;
}

/**
 * `ghcr.io/hanzoai/chat` → `hanzoai/chat`. The apps-table `repo` is the
 * `owner/repo` GitHub coordinate, i.e. the image path minus the registry host.
 * Third-party images with no namespace return the bare name.
 */
export function repoFromRepository(repository: string): string {
	const parts = repository.split("/").filter(Boolean);
	if (parts.length >= 3) return parts.slice(1).join("/");
	return parts.join("/");
}

/** Roll a Deployment's replica counts up to the apps-table health vocabulary. */
export function healthFromDeployment(dep: DeploymentLike | null): AppHealth | null {
	if (!dep) return null;
	const desired = dep.spec?.replicas ?? 0;
	const ready = dep.status?.readyReplicas ?? 0;
	// Intentionally scaled to zero (e.g. chat replicas:0) — not unhealthy, but
	// nothing is running, so it is not green either.
	if (desired === 0) return "yellow";
	if (ready >= desired) return "green";
	if (ready > 0) return "yellow";
	return "red";
}

/**
 * Pick the running tag from a Deployment by matching the container whose image
 * repository equals the CR's declared repository (so a sidecar like
 * `replicate`/`otel` can never be mistaken for the app). Falls back to the first
 * container when no exact match is found.
 */
export function runningTagFromDeployment(
	dep: DeploymentLike | null,
	declaredRepository: string,
): string | null {
	const containers = dep?.spec?.template?.spec?.containers ?? [];
	if (containers.length === 0) return null;
	const match =
		containers.find((c) => {
			if (!c.image) return false;
			const [repo] = parseImageRef(c.image);
			return repo === declaredRepository;
		}) ?? containers[0]!;
	if (!match.image) return null;
	const [, tag] = parseImageRef(match.image);
	return tag || null;
}

/** One observed app, fully mapped and ready to upsert (org tenant resolved later). */
export interface ObservedApp {
	id: string;
	org: string;
	app: string;
	env: AppEnv;
	repo: string;
	registry: string;
	declaredTag: string | null;
	runningTag: string | null;
	health: AppHealth | null;
	cluster: string;
	namespace: string;
}

/**
 * Map a `Service` CR + its (optional) live Deployment into an `ObservedApp`.
 * Returns null for CRs with no image repository (nothing to track).
 */
export function observeService(
	cr: ServiceCR,
	dep: DeploymentLike | null,
	cluster: string,
	namespace: string,
	env: AppEnv,
): ObservedApp | null {
	const name = cr.metadata?.name;
	const repository = cr.spec?.image?.repository;
	if (!name || !repository) return null;

	const org = orgFromRepository(repository);
	const repo = repoFromRepository(repository);
	const declaredTag = cr.spec?.image?.tag ?? null;
	const runningTag = runningTagFromDeployment(dep, repository);

	return {
		id: `${org}/${name}/${env}`,
		org,
		app: name,
		env,
		repo,
		registry: repository,
		declaredTag,
		runningTag,
		health: healthFromDeployment(dep),
		cluster,
		namespace,
	};
}

// ---------------------------------------------------------------------------
// Cluster IO
// ---------------------------------------------------------------------------

function clientsFor(target: ClusterTarget): K8sClients {
	return target.kubeconfig
		? createK8sClients(target.kubeconfig)
		: getDefaultClients();
}

/**
 * Observe every `Service` CR (and its live Deployment) across the target's
 * namespaces. Pure-data out — DB writes happen in `syncInventory`.
 */
export async function discoverApps(
	target: ClusterTarget,
	clients: K8sClients = clientsFor(target),
): Promise<ObservedApp[]> {
	const observed: ObservedApp[] = [];

	for (const [namespace, env] of Object.entries(target.namespaces)) {
		// 1) Declared state: list operator Service CRs in the namespace.
		const crList = (await clients.custom.listNamespacedCustomObject({
			group: OPERATOR_GROUP,
			version: OPERATOR_VERSION,
			namespace,
			plural: SERVICES_PLURAL,
		})) as { items?: ServiceCR[] };
		const crs = crList.items ?? [];

		// 2) Running state: one Deployment list per namespace, indexed by name.
		const depList = await clients.apps.listNamespacedDeployment({ namespace });
		const byName = new Map<string, DeploymentLike>();
		for (const d of depList.items ?? []) {
			const n = d.metadata?.name;
			if (n) byName.set(n, d as DeploymentLike);
		}

		for (const cr of crs) {
			const dep = cr.metadata?.name
				? byName.get(cr.metadata.name) ?? null
				: null;
			const app = observeService(cr, dep, target.cluster, namespace, env);
			if (app) observed.push(app);
		}
	}

	return observed;
}

// ---------------------------------------------------------------------------
// Org-tenant resolution
// ---------------------------------------------------------------------------

/**
 * Map an image namespace ("org") to a platform tenant `organization.id`.
 *
 * Resolution order (first hit wins): exact `slug` match, exact `name` match, a
 * known brand alias (`hanzoai`→`hanzo`, `zooai`→`zoo`, `luxfi`→`lux`), then —
 * when the install has exactly ONE org — that org (single-tenant installs own
 * everything). Returns null when ambiguous, leaving the row tenant-unowned (it
 * still lists on the un-scoped board).
 */
const ORG_ALIASES: Record<string, string[]> = {
	hanzoai: ["hanzo"],
	zooai: ["zoo"],
	luxfi: ["lux"],
};

export async function resolveOrganizationId(
	imageOrg: string,
): Promise<string | null> {
	const orgs = await db
		.select({ id: organization.id, name: organization.name, slug: organization.slug })
		.from(organization);
	if (orgs.length === 0) return null;

	const candidates = [imageOrg, ...(ORG_ALIASES[imageOrg] ?? [])].map((s) =>
		s.toLowerCase(),
	);
	const hit = orgs.find(
		(o) =>
			candidates.includes((o.slug ?? "").toLowerCase()) ||
			candidates.includes(o.name.toLowerCase()),
	);
	if (hit) return hit.id;

	// Single-tenant install: the lone org owns every observed app.
	if (orgs.length === 1) return orgs[0]!.id;
	return null;
}

// ---------------------------------------------------------------------------
// Reconcile into the apps table
// ---------------------------------------------------------------------------

export interface SyncResult {
	observed: number;
	upserted: number;
	cluster: string;
}

/**
 * Observe a target and upsert each app into the `apps` table. Owns only the
 * declared/running/health/topology columns it observes; never touches the
 * release-reader columns (`latestTag`/`releaseUrl`/`releaseAssets`).
 */
export async function syncTarget(
	target: ClusterTarget = DEFAULT_TARGETS[0]!,
): Promise<SyncResult> {
	const observed = await discoverApps(target);
	const now = new Date();

	// Resolve org tenants once per distinct image-org (small set).
	const orgIdCache = new Map<string, string | null>();
	const orgIdFor = async (imageOrg: string): Promise<string | null> => {
		if (!orgIdCache.has(imageOrg)) {
			orgIdCache.set(imageOrg, await resolveOrganizationId(imageOrg));
		}
		return orgIdCache.get(imageOrg) ?? null;
	};

	let upserted = 0;
	for (const o of observed) {
		const organizationId = await orgIdFor(o.org);
		const row: NewApp = {
			id: o.id,
			org: o.org,
			app: o.app,
			env: o.env,
			repo: o.repo,
			registry: o.registry,
			declaredTag: o.declaredTag,
			runningTag: o.runningTag,
			health: o.health,
			cluster: o.cluster,
			namespace: o.namespace,
			organizationId,
			lastObserved: now,
			updatedAt: now,
		};
		await db
			.insert(apps)
			.values(row)
			.onConflictDoUpdate({
				target: apps.id,
				// Only the columns this reader owns. `latestTag`/`releaseUrl`/
				// `releaseAssets` are deliberately omitted so the release reader's
				// observations survive.
				set: {
					org: row.org,
					app: row.app,
					env: row.env,
					repo: row.repo,
					registry: row.registry,
					declaredTag: row.declaredTag,
					runningTag: row.runningTag,
					health: row.health,
					cluster: row.cluster,
					namespace: row.namespace,
					organizationId,
					lastObserved: now,
					updatedAt: now,
				},
			})
			.run();
		upserted += 1;
	}

	return { observed: observed.length, upserted, cluster: target.cluster };
}

/** Sync every configured cluster target. The runtime entry point. */
export async function syncInventory(
	targets: ClusterTarget[] = DEFAULT_TARGETS,
): Promise<SyncResult[]> {
	const results: SyncResult[] = [];
	for (const target of targets) {
		results.push(await syncTarget(target));
	}
	return results;
}

/** Prune apps rows for a cluster whose CR no longer exists (kept observed set). */
export async function pruneMissing(
	cluster: string,
	keepIds: Set<string>,
): Promise<number> {
	const rows = await db
		.select({ id: apps.id })
		.from(apps)
		.where(eq(apps.cluster, cluster));
	let deleted = 0;
	for (const r of rows) {
		if (!keepIds.has(r.id)) {
			await db.delete(apps).where(eq(apps.id, r.id)).run();
			deleted += 1;
		}
	}
	return deleted;
}
