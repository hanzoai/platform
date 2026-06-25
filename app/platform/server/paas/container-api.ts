/**
 * Shared helpers for the PaaS container REST API (/v1/org/.../container*).
 *
 * These endpoints back the Hanzo console "PaaS" page. They are a thin,
 * read-mostly REST surface over the Dokploy `application` data model, shaped to
 * match exactly what the console expects (console
 * web/src/features/platform/types.ts): PaasContainer / PipelineRun.
 *
 * Auth: a shared service bearer token (PAAS_SERVICE_TOKEN). This is a
 * machine-to-machine surface — the console server sends
 * `Authorization: Bearer ${PAAS_SERVICE_TOKEN}` on every call. It deliberately
 * does NOT use the IAM/better-auth session: the platform backend cannot validate
 * IAM user tokens, and the console operator is already authenticated on its own
 * side. The pattern mirrors pages/api/v1/build-callback.ts.
 *
 * These handlers are additive — they introduce a new /v1 surface and never touch
 * existing Dokploy routes, services, or data.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { eq } from "drizzle-orm";
import { db } from "@hanzo/platform/db";
import { applications } from "@hanzo/platform/db/schema";
import {
	methodNotAllowed,
	requireParams,
	requireServiceToken as requireServiceTokenFor,
} from "@/server/v1/http";
import { type AppView, listApps } from "@/server/apps/apps-api";

// Generic /v1 transport helpers live in server/v1/http.ts — re-exported here so
// the existing container handlers keep importing them from one place.
export { methodNotAllowed, requireParams };

/**
 * Namespace where platform-managed workloads actually run. The live workloads
 * are k8s Deployments named == application.appName (managed by universe/ArgoCD),
 * NOT Docker/Swarm containers, so live image/replicas/status come from here.
 */
export const PAAS_NAMESPACE = process.env.PAAS_K8S_NAMESPACE || "hanzo";

// ---------------------------------------------------------------------------
// Auth — shared service token (build-callback.ts pattern). The PaaS surface
// accepts its dedicated PAAS_SERVICE_TOKEN, falling back to the generic
// platform service token.
// ---------------------------------------------------------------------------

export function requireServiceToken(
	req: NextApiRequest,
	res: NextApiResponse,
): boolean {
	return requireServiceTokenFor(req, res, [
		"PAAS_SERVICE_TOKEN",
		"PLATFORM_SERVICE_TOKEN",
	]);
}

// ---------------------------------------------------------------------------
// Scope guard
// ---------------------------------------------------------------------------

/**
 * Verify an application (loaded via findApplicationById, which eager-loads
 * environment.project) belongs to the org/project/env in the request path.
 */
export function appInScope(
	app: any,
	orgId: string,
	projectId: string,
	environmentId: string,
): boolean {
	const env = app?.environment;
	const proj = env?.project;
	return (
		!!proj &&
		proj.organizationId === orgId &&
		proj.projectId === projectId &&
		env.environmentId === environmentId
	);
}

/**
 * List applications in an environment, scoped to the org/project/env. Uses the
 * same proven `environment -> project` relation as findApplicationById, and
 * deliberately avoids findProjectById's heavier nested query (projectTags /
 * libsql / compose relations), which fails against the live DB schema.
 */
export async function listApplicationsInScope(
	orgId: string,
	projectId: string,
	environmentId: string,
): Promise<any[]> {
	const apps = await db.query.applications.findMany({
		where: eq(applications.environmentId, environmentId),
		with: { environment: { with: { project: true } } },
	});
	return (apps as any[]).filter((a) =>
		appInScope(a, orgId, projectId, environmentId),
	);
}

// ---------------------------------------------------------------------------
// Status mapping (Dokploy enums -> console unions). The console mappers are
// substring-lenient, but we normalize explicitly to the canonical values.
// ---------------------------------------------------------------------------

export function mapContainerStatus(
	appStatus: string | null | undefined,
): string {
	switch (appStatus) {
		case "done":
			return "running";
		case "running":
			return "deploying";
		case "error":
			return "failed";
		case "idle":
			return "stopped";
		default:
			return "unknown";
	}
}

export function mapPipelineStatus(
	depStatus: string | null | undefined,
): string {
	switch (depStatus) {
		case "done":
			return "success";
		case "error":
			return "failure";
		case "running":
			return "running";
		case "cancelled":
			return "cancelled";
		default:
			return "pending";
	}
}

// ---------------------------------------------------------------------------
// Mappers -> console shapes
// ---------------------------------------------------------------------------

export interface K8sLiveInfo {
	image?: string;
	replicas?: number;
	ready?: number;
	running?: boolean;
}

export function mapApplicationToContainer(app: any, live?: K8sLiveInfo) {
	const appName: string = app.appName ?? "";
	const fqdn: string = app.name ?? "";
	const dbImage: string = app.dockerImage || "";
	// Prefer the live k8s image, then the DB value. Do not fabricate a registry
	// path — the console renders image verbatim, and a guess could be wrong.
	const image = live?.image || dbImage || "";

	// Prefer live k8s status when available, else the DB applicationStatus enum.
	let status = mapContainerStatus(app.applicationStatus);
	if (live) {
		if (live.running) status = "running";
		else if ((live.ready ?? 0) === 0 && (live.replicas ?? 0) === 0)
			status = "stopped";
	}

	const createdAt: string =
		typeof app.createdAt === "string" ? app.createdAt : new Date(0).toISOString();

	return {
		id: app.applicationId,
		name: appName || fqdn || app.applicationId,
		image,
		status,
		replicas:
			typeof live?.replicas === "number"
				? live.replicas
				: typeof app.replicas === "number"
					? app.replicas
					: undefined,
		createdAt,
		updatedAt: createdAt,
		region: process.env.PAAS_REGION || "do-sfo3",
		domain: fqdn || undefined,
	};
}

// ---------------------------------------------------------------------------
// Inventory fallback — the console PaaS board over the apps-lifecycle table.
//
// The Dokploy `applications` table is empty on installs that deploy through the
// operator (apps run as k8s Deployments reconciled from universe CRs, not as
// Dokploy applications). For those, the real per-org app set lives in the
// `apps` inventory table (declared/running tags, repo, registry, health) that
// backs /v1/apps. When a scope yields no Dokploy applications, the container
// endpoints fall back to this inventory so the board still renders the org's
// REAL deployments as cards.
//
// Org scoping: the inventory `org` column is the brand-aliased platform org
// (e.g. "hanzoai"), not necessarily the customer org slug the console sends in
// the path. A customer's apps are named `<slug>-*` (maxpower-chat,
// maxpower-pics), so we match an app to the requested orgId by EITHER the
// inventory `org` column OR an `<orgId>-`/`<orgId>.` app/repo name prefix. This
// shows exactly that customer's apps (maxpower-*) and nothing else.
// ---------------------------------------------------------------------------

/** Map the inventory env vocabulary ("dev"|"test"|"main") to the path env id. */
function inventoryEnvMatches(appEnv: string, environmentId: string): boolean {
	// The console passes a PaaS environment id; for inventory-backed installs
	// there is no Dokploy environment, so PAAS_ENV_ID is set to the inventory
	// env name directly ("main"/"test"/"dev"). Accept an exact match, and treat
	// a missing/"production"/"prod" path env as "main" for convenience.
	const e = environmentId.toLowerCase();
	if (e === appEnv) return true;
	if ((e === "production" || e === "prod" || e === "") && appEnv === "main")
		return true;
	return false;
}

/** True iff an inventory app belongs to the requested org/customer. */
function inventoryAppInOrg(app: AppView, orgId: string): boolean {
	if (app.org === orgId) return true;
	const slug = orgId.toLowerCase();
	const name = app.app.toLowerCase();
	const repo = app.repo.toLowerCase().split("/").pop() ?? "";
	return (
		name === slug ||
		name.startsWith(slug + "-") ||
		name.startsWith(slug + ".") ||
		repo.startsWith(slug + "-")
	);
}

/** Inventory health ("green"|"yellow"|"red") → console container status. */
function mapInventoryStatus(
	health: string | null | undefined,
	live?: K8sLiveInfo,
): string {
	if (live) {
		if (live.running) return "running";
		if ((live.ready ?? 0) === 0 && (live.replicas ?? 0) === 0) return "stopped";
	}
	switch (health) {
		case "green":
			return "running";
		case "yellow":
			return "deploying";
		case "red":
			return "failed";
		default:
			return "unknown";
	}
}

/** Map one inventory AppView (+ live k8s) into the console PaasContainer. */
export function mapInventoryAppToContainer(
	app: AppView,
	live?: K8sLiveInfo,
	domain?: string,
) {
	const tag = app.runningTag || app.declaredTag || "";
	const image = live?.image || (tag ? `${app.registry}:${tag}` : app.registry);
	const updatedAt =
		typeof app.updatedAt === "string" ? app.updatedAt : new Date(0).toISOString();
	return {
		id: app.id,
		name: app.app,
		image,
		status: mapInventoryStatus(app.health, live),
		replicas: typeof live?.replicas === "number" ? live.replicas : undefined,
		createdAt: app.lastObserved || updatedAt,
		updatedAt,
		region: process.env.PAAS_REGION || "do-sfo3",
		domain,
	};
}

/**
 * List the org's apps from the inventory table as console PaasContainers,
 * enriched with live k8s state + ingress domains. Used when the Dokploy
 * `applications` table has nothing in scope.
 */
export async function listInventoryContainersForOrg(
	orgId: string,
	environmentId: string,
): Promise<ReturnType<typeof mapInventoryAppToContainer>[]> {
	const { apps: all } = await listApps({});
	const scoped = all.filter(
		(a) => inventoryAppInOrg(a, orgId) && inventoryEnvMatches(a.env, environmentId),
	);
	if (scoped.length === 0) return [];
	const live = await getLiveIndex(PAAS_NAMESPACE);
	const domains = await getIngressIndex(PAAS_NAMESPACE);
	return scoped.map((a) =>
		mapInventoryAppToContainer(a, live[a.app], domains[a.app]),
	);
}

export function mapDeploymentToPipelineRun(dep: any) {
	const startedAt: string =
		dep.startedAt || dep.createdAt || new Date(0).toISOString();
	const finishedAt: string | undefined = dep.finishedAt || undefined;
	let durationMs: number | undefined;
	if (startedAt && finishedAt) {
		const d = Date.parse(finishedAt) - Date.parse(startedAt);
		if (Number.isFinite(d) && d >= 0) durationMs = d;
	}
	// description carries "Commit: <hash>" when the deploy came from git.
	let commitSha: string | undefined;
	if (typeof dep.description === "string") {
		const m = dep.description.match(/Commit:\s*([0-9a-f]{7,40})/i);
		if (m) commitSha = m[1];
	}
	return {
		id: dep.deploymentId,
		status: mapPipelineStatus(dep.status),
		commitSha,
		commitMessage: dep.title || undefined,
		startedAt,
		finishedAt,
		durationMs,
	};
}

// ---------------------------------------------------------------------------
// Live k8s enrichment + workload resolution.
//
// Platform workloads run as k8s Deployments reconciled by universe/ArgoCD. The
// Deployment is usually named == application.appName, but some carry the appName
// only as a label (`app` or `app.kubernetes.io/name`), so we match by name OR
// label. All enrichment failures (k8s unreachable, missing RBAC) degrade
// gracefully — LIST/GET still work from the DB alone.
// ---------------------------------------------------------------------------

interface DeploymentInfo {
	name: string;
	labels: Record<string, string>;
	image?: string;
	replicas?: number;
	ready?: number;
}

/** List Deployments in the namespace. Throws on k8s error (unreachable / RBAC). */
async function listDeploymentInfos(
	namespace: string,
): Promise<DeploymentInfo[]> {
	const { getDefaultClients } = await import(
		"@hanzo/platform/services/k8s/k8s-client"
	);
	const { listDeployments } = await import(
		"@hanzo/platform/services/k8s/k8s-deployment"
	);
	const clients = getDefaultClients();
	const deps = await listDeployments(clients, namespace);
	return (deps as any[]).map((d) => ({
		name: d?.metadata?.name,
		labels: d?.metadata?.labels ?? {},
		image: d?.spec?.template?.spec?.containers?.[0]?.image,
		replicas: d?.status?.replicas ?? d?.spec?.replicas,
		ready: d?.status?.readyReplicas ?? 0,
	}));
}

function matchesApp(info: DeploymentInfo, appName: string): boolean {
	return (
		info.name === appName ||
		info.labels.app === appName ||
		info.labels["app.kubernetes.io/name"] === appName
	);
}

/**
 * Build a lookup of appName -> live info, keyed by Deployment name AND the
 * `app` / `app.kubernetes.io/name` labels. Best-effort: returns {} if k8s is
 * unreachable or RBAC is missing, so LIST/GET degrade to DB-only data.
 */
export async function getLiveIndex(
	namespace: string,
): Promise<Record<string, K8sLiveInfo>> {
	try {
		const infos = await listDeploymentInfos(namespace);
		const map: Record<string, K8sLiveInfo> = {};
		for (const i of infos) {
			if (!i.name) continue;
			const info: K8sLiveInfo = {
				image: i.image,
				replicas: i.replicas,
				ready: i.ready,
				running: (i.ready ?? 0) > 0,
			};
			for (const key of [
				i.name,
				i.labels.app,
				i.labels["app.kubernetes.io/name"],
			]) {
				if (key && !(key in map)) map[key] = info;
			}
		}
		return map;
	} catch {
		return {};
	}
}

/**
 * Build a lookup of workload-name -> public domain from the namespace's
 * Ingresses. An ingress routes a host to a backend Service whose name matches
 * the app/Deployment name (operator convention), so we key the host by that
 * service name. Best-effort: returns {} when k8s is unreachable / RBAC missing,
 * so inventory cards still render (just without a domain).
 */
export async function getIngressIndex(
	namespace: string,
): Promise<Record<string, string>> {
	try {
		const { getDefaultClients } = await import(
			"@hanzo/platform/services/k8s/k8s-client"
		);
		const { listIngresses } = await import(
			"@hanzo/platform/services/k8s/k8s-ingress"
		);
		const clients = getDefaultClients();
		const items = (await listIngresses(clients, namespace)) as any[];
		const map: Record<string, string> = {};
		for (const ing of items) {
			for (const rule of ing?.spec?.rules ?? []) {
				const host: string | undefined = rule?.host;
				if (!host) continue;
				for (const p of rule?.http?.paths ?? []) {
					const svc: string | undefined = p?.backend?.service?.name;
					// First host per service wins (a stable, deterministic pick).
					if (svc && !(svc in map)) map[svc] = host;
				}
			}
		}
		return map;
	} catch {
		return {};
	}
}

/**
 * Resolve the live Deployment name backing an application. Returns null when k8s
 * is reachable but no Deployment matches (caller -> 404). Throws when k8s is
 * unreachable / RBAC denied (caller -> 500).
 */
export async function resolveDeploymentName(
	namespace: string,
	appName: string,
): Promise<string | null> {
	const infos = await listDeploymentInfos(namespace);
	const match = infos.find((i) => matchesApp(i, appName));
	return match ? match.name : null;
}

/** Rolling-restart a workload's k8s Deployment (by resolved Deployment name). */
export async function restartWorkload(
	namespace: string,
	deploymentName: string,
): Promise<void> {
	const { getDefaultClients } = await import(
		"@hanzo/platform/services/k8s/k8s-client"
	);
	const { restartDeployment } = await import(
		"@hanzo/platform/services/k8s/k8s-deployment"
	);
	const clients = getDefaultClients();
	await restartDeployment(clients, namespace, deploymentName);
}
