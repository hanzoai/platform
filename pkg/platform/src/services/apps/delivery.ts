/**
 * Delivery reader — the fleet as the DEPLOYER sees it.
 *
 * `inventory.ts` reads the clusters platform can reach directly. That is one
 * cluster: the one platform runs in. Every other org's estate — lux, zoo, and
 * every tenant cluster after them — is invisible to it, and no amount of
 * kubeconfig plumbing fixes that honestly (platform would have to hold
 * cluster-admin credentials for other orgs to look).
 *
 * The deployer already looks, for all of them. Hanzo CD holds one `Application`
 * per delivered app in the `hanzo-cd` namespace of THIS cluster, and each one
 * carries, from CD's own reconcile against the remote cluster:
 *
 *   - `status.summary.images`  — the images CD sees running in the live tree
 *   - `status.sync.status`     — whether those live objects still match git
 *   - `status.sync.revision`   — the git revision it last reconciled to
 *   - `status.health.status`   — the rolled-up health of the live objects
 *
 * So the whole fleet is readable from one namespace, with the read access
 * platform already has (`apps.hanzo.ai` list, `k8s/platform-rbac.yaml`), and no
 * new credential to hold. That is what this module reads.
 *
 * It is READ-ONLY: it lists `Application` and `AppProject` objects and returns
 * data. Writing the `apps` table is `inventory.ts#syncInventory`, the single
 * writer, which merges these observations with its own.
 *
 * WHAT IT DOES NOT CLAIM. CD reports images, sync and health — not hostnames,
 * and not the declared tag as it stands in git right now (only the tag it last
 * applied, when it has applied at all). Those stay null for remotely-delivered
 * apps and render "unknown". A control plane that guesses is worse than one
 * that admits a gap.
 */

import { parseImageRef } from "../ci/image-ref";
import { readDeclared } from "./declared";
import { getDefaultClients, type K8sClients } from "../k8s/k8s-client";
import {
	type AppEnv,
	type AppHealth,
	type AppSync,
	brandOrg,
	envForNamespace,
	nsClass,
	type ObservedApp,
	observedId,
	orgFromRepository,
	repoFromRepository,
} from "./observed";

/** CD's API group/version and the namespace its control plane lives in. */
const CD_GROUP = "apps.hanzo.ai";
const CD_VERSION = "v1";
const CD_NAMESPACE = "hanzo-cd";
const APPLICATIONS = "applications";
const APPPROJECTS = "appprojects";

/** The org an ApplicationSet stamps on every app it generates. */
export const CD_ORG_LABEL = "apps.hanzo.ai/org";
/** The cluster an Application is pinned to, when CD states it outright. */
export const CD_CLUSTER_LABEL = "apps.hanzo.ai/cluster";

/**
 * The API server address that means "the cluster this pod runs in". CD writes it
 * verbatim on every in-cluster destination, so it is the one honest way to tell
 * local delivery from remote.
 */
export const LOCAL_SERVER = "https://kubernetes.default.svc";

// ---------------------------------------------------------------------------
// Wire shapes (only the fields read here; the CD Application is much larger)
// ---------------------------------------------------------------------------

export interface CdSource {
	repoURL?: string;
	path?: string;
	chart?: string;
	targetRevision?: string;
	/** Names this source for `$values/`-prefixed paths in a sibling source. */
	ref?: string;
	helm?: { releaseName?: string; valueFiles?: string[] };
}

export interface CdApplication {
	metadata?: { name?: string; labels?: Record<string, string> };
	spec?: {
		project?: string;
		destination?: { server?: string; name?: string; namespace?: string };
		source?: CdSource;
		sources?: CdSource[];
	};
	status?: {
		sync?: { status?: string; revision?: string };
		health?: { status?: string };
		summary?: { images?: string[] };
	};
}

export interface CdAppProject {
	metadata?: { name?: string };
	spec?: { destinations?: Array<{ server?: string; namespace?: string }> };
}

// ---------------------------------------------------------------------------
// Pure mapping (unit-tested without a cluster)
// ---------------------------------------------------------------------------

/**
 * CD's sync vocabulary in ours. `Synced` and `OutOfSync` are the two verdicts;
 * anything else — including CD's literal `Unknown` and the empty status of an
 * app it has not reached yet — is `unknown`, because "not yet compared" and
 * "compared and matching" are different facts and must not collapse.
 */
export function syncOf(app: CdApplication): AppSync {
	switch (app.status?.sync?.status) {
		case "Synced":
			return "synced";
		case "OutOfSync":
			return "drifted";
		default:
			return "unknown";
	}
}

/**
 * CD's health vocabulary in the board's. `Healthy` is green; `Progressing` and
 * `Suspended` are mid-flight, not broken, so yellow; `Degraded` and `Missing`
 * are red. An absent status is null — unobserved, not healthy.
 */
export function healthOf(app: CdApplication): AppHealth | null {
	switch (app.status?.health?.status) {
		case "Healthy":
			return "green";
		case "Progressing":
		case "Suspended":
			return "yellow";
		case "Degraded":
		case "Missing":
			return "red";
		default:
			return null;
	}
}

/**
 * The release name CD deploys under — the app's own name, independent of the
 * Application object's generated name (`lux-<namespace>-<release>`). Falls back
 * to the Application name for the hand-written apps that declare no Helm
 * release (the universe root apps).
 */
export function releaseOf(app: CdApplication): string | undefined {
	const sources = [app.spec?.source, ...(app.spec?.sources ?? [])].filter(
		(s): s is CdSource => !!s,
	);
	for (const s of sources) {
		if (s.helm?.releaseName) return s.helm.releaseName;
	}
	return app.metadata?.name;
}

/**
 * The image this app IS. CD lists every image in the live tree, sidecars and
 * upstream dependencies included, so pick the one whose repository name matches
 * the release — that is the app itself. With no match, a single image is
 * unambiguous and is taken; several unmatched images mean CD is reporting a
 * bundle (the universe root apps), which has no single identity, so null.
 */
export function primaryImage(
	app: CdApplication,
	release: string,
): string | null {
	const images = app.status?.summary?.images ?? [];
	if (images.length === 0) return null;
	const match = images.find((img) => {
		const [repo] = parseImageRef(img);
		const name = repo.split("/").filter(Boolean).pop();
		return name === release;
	});
	if (match) return match;
	return images.length === 1 ? images[0]! : null;
}

/**
 * Which org owns this app, in evidence order:
 *   1. the `apps.hanzo.ai/org` label the generating ApplicationSet stamps —
 *      an explicit declaration by the party that created the app;
 *   2. a `tenant-<org>` destination namespace, which names its own owner;
 *   3. the brand org of the image namespace (`hanzoai`→`hanzo`, …), the same
 *      single alias table the cluster reader uses;
 *   4. the CD project, which the destination is pinned by.
 * With none of those, the app belongs to whoever runs this control plane, and
 * `fallback` names them.
 */
export function orgOf(
	app: CdApplication,
	image: string | null,
	fallback: string,
): string {
	const declared = app.metadata?.labels?.[CD_ORG_LABEL];
	if (declared) return declared;

	const ns = app.spec?.destination?.namespace ?? "";
	const tenant = nsClass(ns)?.tenant;
	if (tenant) return tenant;

	if (image) {
		const [repository] = parseImageRef(image);
		return brandOrg(orgFromRepository(repository));
	}

	return app.spec?.project ?? fallback;
}

/**
 * Which cluster this app lands on, in evidence order: the label CD stamps when
 * it states the cluster outright; the local cluster when the destination is
 * this cluster's own API server; else the CD project that pins exactly this
 * destination server (`lux`, `zoo`) — the only human-readable name for a remote
 * cluster that platform can read without holding that cluster's credentials.
 * Last resort is the server's own host, which is at least unambiguous.
 */
export function clusterOf(
	app: CdApplication,
	serverToProject: Map<string, string>,
	localCluster: string,
): string {
	const labelled = app.metadata?.labels?.[CD_CLUSTER_LABEL];
	if (labelled) return labelled;

	const server = app.spec?.destination?.server ?? "";
	if (!server || server === LOCAL_SERVER) return localCluster;

	const project = serverToProject.get(server);
	if (project) return project;

	try {
		return new URL(server).hostname;
	} catch {
		return server;
	}
}

/**
 * Server → project name, for the projects that pin EXACTLY ONE destination
 * server. A project spanning several servers (or the wildcard `*`) names no
 * single cluster and is skipped; the local server is skipped too, since every
 * first-party project pins it and the winner would be arbitrary.
 */
export function serverProjects(projects: CdAppProject[]): Map<string, string> {
	const out = new Map<string, string>();
	for (const p of projects) {
		const name = p.metadata?.name;
		const servers = new Set(
			(p.spec?.destinations ?? [])
				.map((d) => d.server)
				.filter((s): s is string => !!s && s !== "*"),
		);
		if (!name || servers.size !== 1) continue;
		const server = [...servers][0]!;
		if (server === LOCAL_SERVER || out.has(server)) continue;
		out.set(server, name);
	}
	return out;
}

/**
 * One CD Application as an observation. Returns null for an app with no
 * destination namespace — it delivers nothing to a cluster and has no place to
 * be on a board of running things.
 *
 * `declaredTag` is deliberately absent: CD's status says what is RUNNING and
 * whether it matches git, never what git currently declares. Filling it from
 * the running tag would make every remote app read "no drift" by construction.
 */
export function observeDelivered(
	app: CdApplication,
	serverToProject: Map<string, string>,
	localCluster: string,
	fallbackOrg: string,
): ObservedApp | null {
	const namespace = app.spec?.destination?.namespace;
	const release = releaseOf(app);
	if (!namespace || !release) return null;

	const image = primaryImage(app, release);
	const [repository, tag] = image ? parseImageRef(image) : [null, null];
	const cluster = clusterOf(app, serverToProject, localCluster);
	const env: AppEnv = envForNamespace(namespace);

	return {
		id: observedId(cluster, namespace, release),
		org: orgOf(app, image, fallbackOrg),
		app: release,
		env,
		repo: repository ? repoFromRepository(repository) : null,
		registry: repository,
		declaredTag: null,
		runningTag: tag || null,
		health: healthOf(app),
		syncStatus: syncOf(app),
		syncRevision: app.status?.sync?.revision ?? null,
		cluster,
		namespace,
		hosts: [],
	};
}

// ---------------------------------------------------------------------------
// Cluster IO
// ---------------------------------------------------------------------------

async function listCd<T>(clients: K8sClients, plural: string): Promise<T[]> {
	try {
		const res = (await clients.custom.listNamespacedCustomObject({
			group: CD_GROUP,
			version: CD_VERSION,
			namespace: CD_NAMESPACE,
			plural,
		})) as { items?: T[] };
		return res.items ?? [];
	} catch (err) {
		// No CD on this install (404 = the CRD is absent) means no delivered apps
		// to report — an empty fleet, not a failure. Anything else (RBAC denial,
		// API outage) is re-thrown: a forbidden list must never be reported as
		// "nothing is deployed".
		const code =
			(err as { code?: number; statusCode?: number })?.code ??
			(err as { statusCode?: number })?.statusCode;
		if (code === 404) return [];
		throw err;
	}
}

/**
 * Observe every app CD delivers, on every cluster it delivers to. Pure data
 * out; the single writer (`inventory.ts#syncInventory`) merges and persists.
 */
export async function discoverDelivered(
	localCluster: string,
	fallbackOrg: string,
	clients: K8sClients = getDefaultClients(),
): Promise<ObservedApp[]> {
	const [applications, projects] = await Promise.all([
		listCd<CdApplication>(clients, APPLICATIONS),
		listCd<CdAppProject>(clients, APPPROJECTS),
	]);
	const serverToProject = serverProjects(projects);

	// What each app is DECLARED to run, read from the universe it is reconciled
	// from. CD reports what is running and whether it matches git; it never
	// reports what git says now, so this column was null for every app on every
	// cluster and the board had nothing to compare a running tag against.
	//
	// The pointer is on the Application itself, so no per-org registry of repos
	// is needed and an org is onboarded by being reconciled. A file that cannot
	// be read leaves the app absent from the map and the column stays unknown —
	// which is true, and is what it said before.
	const declared = await readDeclared(applications);

	const observed: ObservedApp[] = [];
	for (const app of applications) {
		const row = observeDelivered(
			app,
			serverToProject,
			localCluster,
			fallbackOrg,
		);
		if (!row) continue;
		const tag = declared.get(app.metadata?.name ?? "");
		observed.push(tag ? { ...row, declaredTag: tag } : row);
	}
	return observed;
}
