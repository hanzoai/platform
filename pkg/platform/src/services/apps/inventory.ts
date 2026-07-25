/**
 * Live apps inventory — the "observe" reader of the control plane
 * (`docs/APPS_LIFECYCLE.md` §1, readers `read_declared_tag` + `read_running_tag`,
 * unified into one cluster pass).
 *
 * The platform pod runs in-cluster as `platform-app` (k8s/platform-rbac.yaml),
 * whose ClusterRole grants the `hanzo.ai` CR groups (list) and `apps/deployments`
 * + `pods` (list/get). This module uses that access to reconcile the `apps`
 * table from REALITY:
 *
 *   - `declaredTag`  ← the operator `App` CR's `spec.image.tag`
 *                      (what SHOULD run — the declared-state source of truth).
 *   - `runningTag`   ← the live workload's container image tag (what ACTUALLY
 *                      runs). Deployment OR StatefulSet — the operator creates
 *                      both, and they are identical in every field read here.
 *   - `health`       ← rolled up from that workload's ready/desired replicas.
 *   - `hosts`        ← `spec.ingress.hosts` — where the thing actually answers.
 *
 * The workload kind is `App` (`APPS_PLURAL`). `Service` is the v0.3.0 alias it
 * replaced and is NOT scanned: the fleet holds 82 `apps.hanzo.ai` and 0
 * `services.hanzo.ai`, so a second lookup would only ever return an empty set.
 *
 * It is READ-MOSTLY: it lists CRs + Deployments and writes ONLY to platform's
 * own SQLite `apps` table. It NEVER mutates a cluster object, so it cannot
 * affect the control plane or the live services it observes. The lifecycle
 * WRITE path (patching a workload CR to a new tag) lives in the CI deploy
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
	type appEnvValues,
	type appHealthValues,
	apps,
	type NewApp,
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
	createK8sClients,
	getDefaultClients,
	type K8sClients,
} from "../k8s/k8s-client";

const OPERATOR_GROUP = "hanzo.ai";
const OPERATOR_VERSION = "v1";
// `apps`, not `services`: the operator's Service kind is a v0.3.0 alias that no
// CR in the fleet uses — the cluster holds 82 `apps.hanzo.ai` and 0
// `services.hanzo.ai`, so listing services returned an empty set and the board
// reported "synced 0 apps" against a fully-populated cluster. Both kinds share
// the same spec shape (`spec.image.{repository,tag}`), so only the plural moves.
const APPS_PLURAL = "apps";

/**
 * The clusters this platform install observes. hanzo-k8s is the shared platform
 * cluster: the `hanzo` namespace is production (`main`); the env-split namespaces
 * map to test/dev (Hanzo 3-env split — `svc.{testnet,devnet}.hanzo.ai`); and
 * `tenant-<org>` namespaces are customers' own. Which namespaces those ARE is
 * DISCOVERED per pass (`discoverNamespaces` + `nsClass`), not hardcoded.
 *
 * Cross-cluster federation (lux-k8s / zoo-k8s) is added by appending entries
 * here whose `kubeconfig` is loaded from KMS — see the report. The default
 * (in-cluster) target needs no kubeconfig.
 */
export interface ClusterTarget {
	/** Logical cluster name recorded on each app row, e.g. `hanzo-k8s`. */
	cluster: string;
	/**
	 * Namespace → env map. OMIT to discover the scan set from the cluster
	 * (`discoverNamespaces`) — that is the production path. Supplying it pins the
	 * scan to exactly these namespaces, which is what the unit tests want and what
	 * a remote target may need when its RBAC cannot list namespaces.
	 */
	namespaces?: Record<string, AppEnv>;
	/** Optional kubeconfig YAML for a remote cluster; omit for in-cluster. */
	kubeconfig?: string;
}

/**
 * Default target: the in-cluster hanzo-k8s. No `namespaces` — the scan set is
 * DISCOVERED (see `discoverNamespaces`), so a tenant onboarded after this pod
 * started appears on the board without a redeploy.
 */
export const DEFAULT_TARGETS: ClusterTarget[] = [{ cluster: "hanzo-k8s" }];

/**
 * Namespace → (tenant, env), or null when the namespace is not ours.
 *
 * THE one rule for "is this namespace part of the estate, and which env is it?".
 * Ported rule-for-rule from cloud's `clients/paas` `nsClass` (Go) — the two must
 * agree or the board and `/v1/paas/apps` disagree about what the fleet IS. Two
 * languages, one rule: change them together.
 *
 * Total by construction: every string classifies, and anything unrecognised
 * classifies OUT. Widening the estate is a one-line change HERE (and in the Go
 * twin), never a literal list edited at each call site.
 */
export function nsClass(ns: string): { tenant: string; env: AppEnv } | null {
	switch (ns) {
		case "hanzo":
		case "hanzo-mainnet":
			return { tenant: "hanzo", env: "main" };
		case "hanzo-testnet":
			return { tenant: "hanzo", env: "test" };
		case "hanzo-devnet":
			return { tenant: "hanzo", env: "dev" };
	}
	// tenant-<org>: a customer's own namespace. The org IS the tenant key, so it
	// classifies exactly like a first-party namespace with no special case.
	const t = ns.startsWith("tenant-") ? ns.slice("tenant-".length) : "";
	return t ? { tenant: t, env: "main" } : null;
}

/**
 * The first-party namespaces, main before test/dev. This is the FAIL-SAFE scan
 * set: narrower than the truth, never wider, so a discovery failure can only
 * lose visibility of a tenant's own namespace — never grant visibility of
 * someone else's.
 */
export const FIRST_PARTY_NAMESPACES = [
	"hanzo",
	"hanzo-testnet",
	"hanzo-devnet",
] as const;

function firstPartyScanSet(): Record<string, AppEnv> {
	const out: Record<string, AppEnv> = {};
	for (const ns of FIRST_PARTY_NAMESPACES) out[ns] = nsClass(ns)!.env;
	return out;
}

/**
 * Every namespace in the cluster that `nsClass` recognises, first-party first
 * (so a bare app name still resolves to production) then tenants in stable order.
 *
 * This is what makes `tenant-<org>` workloads visible at all: they classified
 * correctly but were never SCANNED, because the scan set was a hardcoded literal
 * that goes stale the moment a tenant is onboarded. Asking the cluster "which
 * namespaces exist?" is the honest question; deriving the set from a cluster-wide
 * CR list would answer a different one ("where are there CRs?").
 *
 * Fail-SAFE, never fail-open: a list error falls back to the first-party set, and
 * `nsClass` still filters, so a namespace that is not ours can never enter the
 * scan set however discovery goes.
 */
export async function discoverNamespaces(
	clients: K8sClients,
): Promise<Record<string, AppEnv>> {
	let names: string[];
	try {
		const res = await clients.core.listNamespace();
		names = (res.items ?? [])
			.map((n) => n.metadata?.name)
			.filter((n): n is string => typeof n === "string" && n.length > 0);
	} catch {
		return firstPartyScanSet();
	}
	// First-party is always present, even if the list somehow omitted it.
	const out = firstPartyScanSet();
	for (const ns of [...names].sort()) {
		const c = nsClass(ns);
		if (c) out[ns] = c.env;
	}
	return out;
}

// ---------------------------------------------------------------------------
// Wire shapes (only the fields we read; the operator CR is much larger)
// ---------------------------------------------------------------------------

/**
 * A workload CR (`App` today, `Service` historically) — only the fields this
 * reader consumes. Both kinds share this shape exactly.
 */
interface WorkloadCR {
	metadata?: {
		name?: string;
		labels?: Record<string, string>;
		annotations?: Record<string, string>;
	};
	spec?: {
		image?: { repository?: string; tag?: string };
		/** Public routing the operator publishes for this workload. */
		ingress?: { enabled?: boolean; hosts?: string[] };
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

// ---------------------------------------------------------------------------
// Org attribution — the ONE brand-alias source of truth
// ---------------------------------------------------------------------------

/**
 * Canonical brand org for a known image namespace. This is the SINGLE source of
 * truth for the `hanzoai`→`hanzo` / `zooai`→`zoo` / `luxfi`→`lux` brand alias,
 * applied to BOTH the `apps.org` column (`brandOrg`, below) and the tenant FK
 * (`resolveOrganizationId`, which derives `ORG_ALIASES` from this map). A
 * first-party `ghcr.io/hanzoai/*` service IS the Hanzo org, so the board groups
 * it under `hanzo` (the IAM/brand org the console scopes by) — never the raw
 * registry namespace `hanzoai`. Unknown namespaces (grafana, meilisearch, …)
 * pass through unchanged: they are genuinely their own upstream, not a Hanzo
 * product, and must not be swept into the brand org.
 */
export const BRAND_ORG: Record<string, string> = {
	hanzoai: "hanzo",
	zooai: "zoo",
	luxfi: "lux",
};

/** Canonicalize an image namespace to its brand org (identity when unknown). */
export function brandOrg(imageOrg: string): string {
	return BRAND_ORG[imageOrg] ?? imageOrg;
}

/**
 * The operator-CR org-attribution key. An explicit `hanzo.ai/org` on the Service
 * CR (as a label OR an annotation) DECLARES the owning org and wins over the
 * image-namespace inference — so a service whose org differs from its image
 * namespace (e.g. a tenant app deployed into the `hanzo` namespace, or a shared
 * image published under `hanzoai` but owned by another org) attributes correctly.
 */
export const ORG_LABEL = "hanzo.ai/org";

/** The org explicitly declared on a CR via `hanzo.ai/org` (label or annotation). */
export function declaredOrg(cr: WorkloadCR): string | undefined {
	const meta = cr.metadata;
	return meta?.labels?.[ORG_LABEL] ?? meta?.annotations?.[ORG_LABEL];
}

/**
 * Resolve the org a Service CR attributes to, in precedence order:
 *   1. an explicit `hanzo.ai/org` label/annotation on the CR (declared owner);
 *   2. else the brand org of the image namespace (`hanzoai`→`hanzo`, …), so a
 *      first-party service groups under its brand/IAM org on the board.
 */
export function orgForService(cr: WorkloadCR, repository: string): string {
	return declaredOrg(cr) ?? brandOrg(orgFromRepository(repository));
}

/** Roll a Deployment's replica counts up to the apps-table health vocabulary. */
export function healthFromDeployment(
	dep: DeploymentLike | null,
): AppHealth | null {
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
	/** Public hostnames from `spec.ingress.hosts`; empty for internal workloads. */
	hosts: string[];
}

/**
 * Public hostnames a workload CR publishes. Empty when ingress is absent or
 * explicitly disabled — a disabled ingress block may still list stale hosts,
 * and reporting an unreachable URL is worse than reporting none.
 */
export function hostsFor(cr: WorkloadCR): string[] {
	const ing = cr.spec?.ingress;
	if (!ing || ing.enabled === false) return [];
	return (ing.hosts ?? []).filter(
		(h): h is string => typeof h === "string" && h.length > 0,
	);
}

/**
 * Map a workload CR + its (optional) live Deployment/StatefulSet into an
 * `ObservedApp`.
 *
 * Returns null for a CR with no `spec.image.repository`. That is a real kind, not
 * a defect: the operator's App CR also expresses ROUTE-ONLY objects (`hanzo-domains`,
 * `hanzo-app-sites` carry `spec.domains[]` and no image), which declare ingress for
 * OTHER services and run no workload of their own. They have no declared tag, no
 * running tag and no health, so every column this board compares is undefined —
 * listing them would add rows that can only ever read `red`. Dropping them is the
 * answer; the bug was that the drop was undocumented.
 */
export function observeService(
	cr: WorkloadCR,
	dep: DeploymentLike | null,
	cluster: string,
	namespace: string,
	env: AppEnv,
): ObservedApp | null {
	const name = cr.metadata?.name;
	const repository = cr.spec?.image?.repository;
	if (!name || !repository) return null;

	const org = orgForService(cr, repository);
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
		hosts: hostsFor(cr),
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
 * List one workload plural in a namespace. A missing CRD (or a namespace with
 * no such resource) is a 404 and means "this cluster does not use that kind" —
 * an empty list, not an error. Anything else (RBAC denial, API outage) is
 * re-thrown: a forbidden list must never be silently reported as zero apps.
 */
async function listWorkloadCRs(
	clients: K8sClients,
	namespace: string,
	plural: string,
): Promise<WorkloadCR[]> {
	try {
		const res = (await clients.custom.listNamespacedCustomObject({
			group: OPERATOR_GROUP,
			version: OPERATOR_VERSION,
			namespace,
			plural,
		})) as { items?: WorkloadCR[] };
		return res.items ?? [];
	} catch (err) {
		const code =
			(err as { code?: number; statusCode?: number })?.code ??
			(err as { statusCode?: number })?.statusCode;
		if (code === 404) return [];
		throw err;
	}
}

/**
 * Observe every workload CR (and its live Deployment) across the target's
 * namespaces. Pure-data out — DB writes happen in `syncInventory`.
 */
export async function discoverApps(
	target: ClusterTarget,
	clients: K8sClients = clientsFor(target),
): Promise<ObservedApp[]> {
	const observed: ObservedApp[] = [];
	const namespaces = target.namespaces ?? (await discoverNamespaces(clients));

	for (const [namespace, env] of Object.entries(namespaces)) {
		// 1) Declared state: list operator Service CRs in the namespace.
		const crList = (await clients.custom.listNamespacedCustomObject({
			group: OPERATOR_GROUP,
			version: OPERATOR_VERSION,
			namespace,
			plural: APPS_PLURAL,
		})) as { items?: WorkloadCR[] };
		const crs = crList.items ?? [];

		// 2) Running state, indexed by name. BOTH workload kinds the operator
		// creates: Deployment and StatefulSet. They are structurally identical for
		// everything read here (`spec.replicas`, `spec.template…containers[].image`,
		// `status.readyReplicas`), so one index serves both — listing only
		// Deployments is why the StatefulSet-backed apps (`kv`, `sql`) reported a
		// null running-tag and null health.
		const byName = new Map<string, DeploymentLike>();
		const [depList, stsList] = await Promise.all([
			clients.apps.listNamespacedDeployment({ namespace }),
			clients.apps.listNamespacedStatefulSet({ namespace }),
		]);
		for (const w of [...(depList.items ?? []), ...(stsList.items ?? [])]) {
			const n = w.metadata?.name;
			if (n) byName.set(n, w as DeploymentLike);
		}

		for (const cr of crs) {
			const dep = cr.metadata?.name
				? (byName.get(cr.metadata.name) ?? null)
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
// Derived from the ONE brand-alias source (`BRAND_ORG`) so the image-namespace →
// brand-org mapping cannot drift between the `org` column and the tenant FK.
// `{ hanzoai: ["hanzo"], zooai: ["zoo"], luxfi: ["lux"] }`.
const ORG_ALIASES: Record<string, string[]> = Object.fromEntries(
	Object.entries(BRAND_ORG).map(([imageOrg, brand]) => [imageOrg, [brand]]),
);

export async function resolveOrganizationId(
	imageOrg: string,
): Promise<string | null> {
	const orgs = await db
		.select({
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
		})
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
	/** Rows deleted because their CR no longer exists in the cluster. */
	pruned: number;
	cluster: string;
}

/**
 * Observe a target and upsert each app into the `apps` table. Owns only the
 * declared/running/health/topology columns it observes; never touches the
 * release-reader columns (`latestTag`/`releaseUrl`/`releaseAssets`).
 *
 * The table MIRRORS the cluster: after upserting, rows for this cluster whose CR
 * is gone are pruned (`pruneMissing`), so a deleted app leaves the board instead
 * of lingering forever as a phantom. Two ways a row goes stale, both fixed here:
 * the CR is deleted, or its ATTRIBUTION changes (the row id embeds `org`, so a
 * re-attributed app is written under a new id and orphans the old one).
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
			hosts: o.hosts,
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
					hosts: row.hosts,
					organizationId,
					lastObserved: now,
					updatedAt: now,
				},
			})
			.run();
		upserted += 1;
	}

	// Mirror deletions. Guarded on a NON-EMPTY observation: an empty result is
	// indistinguishable from "every app was deleted", and a transient blip must
	// never be able to empty the board. (A genuine RBAC/API failure throws out of
	// `discoverApps` before reaching here, so this only guards the ambiguous case.)
	// The namespace scope is derived from what was OBSERVED, not from the intended
	// scan set, so prune authority never exceeds proven observation.
	const pruned = observed.length
		? await pruneMissing(
				target.cluster,
				new Set(observed.map((o) => o.id)),
				new Set(observed.map((o) => o.namespace)),
			)
		: 0;

	return {
		observed: observed.length,
		upserted,
		pruned,
		cluster: target.cluster,
	};
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

/**
 * Delete this cluster's rows whose CR no longer exists, so the board mirrors
 * reality instead of accumulating phantoms.
 *
 * DOUBLY SCOPED, because a DELETE must never reach further than the evidence:
 *   - `cluster` — rows belonging to another cluster are untouched, so the
 *     directly-seeded cross-cluster estate (lux-k8s / zoo-k8s) survives a
 *     hanzo-k8s pass. A target only ever prunes what it observes.
 *   - `namespaces` — only namespaces this pass PROVABLY scanned (i.e. actually
 *     yielded rows). The scan set is DISCOVERED (`discoverNamespaces`) and
 *     narrows fail-safe to first-party on a list error; without this scope, one
 *     failed namespace list would delete every `tenant-<org>` app from the board.
 *     The cost is conservative in the safe direction: emptying a namespace
 *     entirely leaves its rows until something is observed there again.
 */
export async function pruneMissing(
	cluster: string,
	keepIds: Set<string>,
	namespaces: Set<string>,
): Promise<number> {
	const rows = await db
		.select({ id: apps.id, namespace: apps.namespace })
		.from(apps)
		.where(eq(apps.cluster, cluster));
	let deleted = 0;
	for (const r of rows) {
		if (!r.namespace || !namespaces.has(r.namespace)) continue;
		if (keepIds.has(r.id)) continue;
		await db.delete(apps).where(eq(apps.id, r.id)).run();
		deleted += 1;
	}
	return deleted;
}
