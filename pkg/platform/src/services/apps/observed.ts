/**
 * The vocabulary of an observation — shared by every reader that reports what
 * is deployed.
 *
 * Two readers answer that question from different vantage points: `inventory.ts`
 * reads the live objects of a cluster it can reach; `delivery.ts` reads what the
 * deployer reports for every cluster, including the ones it cannot. They must
 * agree on what an app IS — its identity, its env, its owning org — or the board
 * shows one thing twice under two names. Those rules live here, once, so
 * neither reader can drift from the other.
 *
 * Nothing here does IO. Nothing here writes.
 */

/** Deployment env vocabulary. `main` is production (`docs/APPS_LIFECYCLE.md`). */
export const appEnvNames = ["dev", "test", "main"] as const;
export type AppEnv = (typeof appEnvNames)[number];

/** Aggregate health rolled up from the live workload. */
export type AppHealth = "green" | "yellow" | "red";

/** What the deployer says about the gap between git and the live objects. */
export type AppSync = "synced" | "drifted" | "unknown";

/**
 * The org that runs this control plane, and therefore owns any app that names
 * no other owner. Not a default so much as the honest answer: an app delivered
 * by our CD, into our cluster, with no org label and no tenant namespace, is
 * ours.
 */
export const SELF_ORG = "hanzo";

// ---------------------------------------------------------------------------
// Namespace rules
// ---------------------------------------------------------------------------

/**
 * Which environment a namespace is, for ANY org. The estate names its
 * environments the same way everywhere — `<x>-testnet`, `<x>-devnet`, and
 * production plain — so this is one rule, not a table that gains a row per org
 * (`lux-testnet` and `zoo-devnet` classify without anyone editing it).
 *
 * Separate from `nsClass` on purpose: "which env is this" and "is this
 * namespace ours to scan" are different questions, and only the second may
 * narrow a scan set.
 */
export function envForNamespace(ns: string): AppEnv {
	if (ns.endsWith("-testnet")) return "test";
	if (ns.endsWith("-devnet")) return "dev";
	return "main";
}

/**
 * Namespace → (tenant, env), or null when the namespace is not ours to scan.
 *
 * THE one rule for "is this namespace part of the estate this cluster hosts,
 * and whose is it?". Ported rule-for-rule from cloud's `clients/paas` `nsClass`
 * (Go) — the two must agree or the board and `/v1/paas/apps` disagree about what
 * the fleet IS. Two languages, one rule: change them together.
 *
 * Total by construction: every string classifies, and anything unrecognised
 * classifies OUT. Widening the estate is a one-line change HERE (and in the Go
 * twin), never a literal list edited at each call site.
 */
export function nsClass(ns: string): { tenant: string; env: AppEnv } | null {
	switch (ns) {
		case "hanzo":
		case "hanzo-mainnet":
		case "hanzo-testnet":
		case "hanzo-devnet":
			return { tenant: SELF_ORG, env: envForNamespace(ns) };
	}
	// tenant-<org>: a customer's own namespace. The org IS the tenant key, so it
	// classifies exactly like a first-party namespace with no special case.
	const t = ns.startsWith("tenant-") ? ns.slice("tenant-".length) : "";
	return t ? { tenant: t, env: envForNamespace(ns) } : null;
}

// ---------------------------------------------------------------------------
// Org attribution — the ONE brand-alias source of truth
// ---------------------------------------------------------------------------

/**
 * Canonical brand org for a known image namespace. This is the SINGLE source of
 * truth for the `hanzoai`→`hanzo` / `zooai`→`zoo` / `luxfi`→`lux` brand alias,
 * applied to BOTH the `apps.org` column and the tenant FK (`resolveOrganizationId`
 * derives its alias table from this map). A first-party `ghcr.io/hanzoai/*`
 * service IS the Hanzo org, so the board groups it under `hanzo` (the IAM/brand
 * org the console scopes by) — never the raw registry namespace `hanzoai`.
 * Unknown namespaces (grafana, meilisearch, …) pass through unchanged: they are
 * genuinely their own upstream, not a first-party product, and must not be
 * swept into a brand org.
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
// The observation itself
// ---------------------------------------------------------------------------

/**
 * One observed app, ready to write. Both readers emit exactly this, so merging
 * them is a fold over one type rather than a translation between two.
 *
 * Every field is what was SEEN. Null means the reader could not see it, and no
 * reader may substitute a plausible value for one it cannot observe — the board
 * showing "unknown" is the point.
 */
export interface ObservedApp {
	/**
	 * `<cluster>/<namespace>/<app>` — where the thing runs. Unique by Kubernetes
	 * construction, which is why it is also the row's primary key: an app is
	 * identified by where it runs, not by a name that repeats across namespaces.
	 */
	id: string;
	org: string;
	app: string;
	env: AppEnv;
	/** `owner/repo`; null when no image was observed. */
	repo: string | null;
	/** Image repository; null when no image was observed. */
	registry: string | null;
	declaredTag: string | null;
	runningTag: string | null;
	health: AppHealth | null;
	/** What the deployer says; null when no deployer manages this app. */
	syncStatus: AppSync | null;
	/** The git revision the deployer last reconciled to. */
	syncRevision: string | null;
	cluster: string;
	namespace: string;
	/** Public hostnames the workload publishes; empty for internal workloads. */
	hosts: string[];
}

/** The row identity: where the thing runs. */
export const observedId = (
	cluster: string,
	namespace: string,
	app: string,
): string => `${cluster}/${namespace}/${app}`;

/**
 * Fold two readers' observations of the same fleet into one row per app.
 *
 * The readers see overlapping slices of one estate. Where both saw an app,
 * neither is discarded — each supplies only the fields it can actually witness:
 *
 *   - the DIRECT reader wins on declared tag, running tag, health, hosts and
 *     org attribution. It read the objects themselves; the deployer reports a
 *     summary of them.
 *   - the DELIVERED reader alone supplies sync status and revision — nothing
 *     else knows whether git and the cluster still agree.
 *
 * Field-level, so a null from the stronger reader never erases a value the
 * weaker one genuinely observed.
 */
export function mergeObserved(
	direct: ObservedApp[],
	delivered: ObservedApp[],
): ObservedApp[] {
	const merged = new Map<string, ObservedApp>();
	for (const d of delivered) merged.set(d.id, d);

	for (const c of direct) {
		const d = merged.get(c.id);
		if (!d) {
			merged.set(c.id, c);
			continue;
		}
		merged.set(c.id, {
			...c,
			repo: c.repo ?? d.repo,
			registry: c.registry ?? d.registry,
			declaredTag: c.declaredTag ?? d.declaredTag,
			runningTag: c.runningTag ?? d.runningTag,
			health: c.health ?? d.health,
			syncStatus: d.syncStatus,
			syncRevision: d.syncRevision,
			hosts: c.hosts.length ? c.hosts : d.hosts,
		});
	}
	return [...merged.values()];
}
