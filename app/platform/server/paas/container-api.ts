/**
 * Shared helpers for the PaaS container REST API (/v1/org/.../container*).
 *
 * These endpoints back the Hanzo console "PaaS" page. They are a thin,
 * read-mostly REST surface over the `application` data model, shaped to
 * match exactly what the console expects (console
 * web/src/features/platform/types.ts): PaasContainer / PipelineRun.
 *
 * Auth: a shared service bearer token (PAAS_SERVICE_TOKEN). This is a
 * machine-to-machine surface — the console server sends
 * `Authorization: Bearer ${PAAS_SERVICE_TOKEN}` on every call. It deliberately
 * does NOT use the IAM/better-auth session: the platform backend cannot validate
 * IAM user tokens, and the console operator is already authenticated on its own
 * side. The pattern mirrors app/v1/build-callback/route.ts.
 *
 * These handlers are additive — they introduce a new /v1 surface and never touch
 * existing routes, services, or data.
 */

import { db } from "@hanzo/platform/db";
import { applications } from "@hanzo/platform/db/schema";
import { eq } from "drizzle-orm";
import {
	methodNotAllowed,
	requireServiceToken as requireServiceTokenFor,
	type ServiceTokenResult,
} from "@/server/v1/http";

// Generic /v1 transport helpers live in server/v1/http.ts — re-exported here so
// the container route handlers keep importing them from one place.
export { methodNotAllowed };

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

export function requireServiceToken(req: Request): ServiceTokenResult {
	return requireServiceTokenFor(req, [
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
// Status mapping (platform enums -> console unions). The console mappers are
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
		typeof app.createdAt === "string"
			? app.createdAt
			: new Date(0).toISOString();

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
