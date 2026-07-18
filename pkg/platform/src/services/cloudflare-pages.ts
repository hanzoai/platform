/**
 * Cloudflare Pages — per-org client of the Hanzo Cloud /v1/cloudflare/pages plane.
 *
 * This REPLACES the global-env-token Pages path (the old cloudflare.ts Pages
 * functions that rode getCloudflareConfig() → CLOUDFLARE_API_TOKEN). Instead of
 * reaching Cloudflare directly with one shared token, it delegates to cloud's
 * per-org /v1/cloudflare/pages/* surface. Cloud resolves the ORG's OWN KMS-sealed
 * Cloudflare token in-process (the token the org connected via the integrations
 * connector) and scopes every call to that org — so the platform never holds a
 * global Cloudflare token for Pages again. One token, one custody boundary, per org.
 *
 * Auth (mirrors hanzo-dns-provider.ts + the per-org billing.ts precedent): the cloud
 * base URL comes from HANZO_CLOUD_API_URL (default https://api.hanzo.ai); the request
 * carries a service bearer (HANZO_CLOUD_API_TOKEN) that cloud validates, plus an
 * X-Org-Id naming the acting org so cloud's identity boundary scopes the resolved
 * Cloudflare token to THAT org. (The service bearer must be a principal cloud honors
 * for an org-switch; see the deploy note in the connector wiring.)
 */

import type {
	CloudflarePagesCustomDomain,
	CloudflarePagesDeployment,
	CloudflarePagesProject,
	PagesProjectCreateParams,
} from "./cloudflare";

const DEFAULT_BASE_URL = "https://api.hanzo.ai";
const API_PREFIX = "/v1/cloudflare/pages";

/** Cloud API origin (no `/api/` prefix — the surface lives under `/v1`). */
function baseUrl(): string {
	return (process.env.HANZO_CLOUD_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/**
 * The service bearer the platform presents to cloud. Required: without it cloud has
 * no validated principal and refuses the request (403), so a missing token fails
 * loud here rather than silently unauthenticated downstream.
 */
function serviceToken(): string {
	const token = process.env.HANZO_CLOUD_API_TOKEN;
	if (!token) {
		throw new Error(
			"HANZO_CLOUD_API_TOKEN environment variable is required to manage Cloudflare Pages",
		);
	}
	return token;
}

interface CloudFetchOptions {
	method?: string;
	body?: unknown;
}

/**
 * Per-org fetch against cloud's /v1/cloudflare/pages plane. The org rides the
 * X-Org-Id header (the ONLY tenant key); cloud derives the Cloudflare token from it.
 * Unwraps cloud's JSON, throws a clean error on non-2xx (never surfacing a token).
 */
async function cloudPagesFetch<T>(
	org: string,
	path: string,
	options: CloudFetchOptions = {},
): Promise<T> {
	if (!org) {
		throw new Error("an organization is required to manage Cloudflare Pages");
	}
	const response = await fetch(`${baseUrl()}${API_PREFIX}${path}`, {
		method: options.method ?? "GET",
		headers: {
			Authorization: `Bearer ${serviceToken()}`,
			"X-Org-Id": org,
			"Content-Type": "application/json",
		},
		body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
	});

	// Comingling guardrail. On any SERVED (2xx) response, cloud stamps X-Hanzo-Org with
	// the org whose Cloudflare token it actually used. If it differs from the org we
	// asked for, the service credential is NOT org-switch-capable (SuperAdmin) and
	// cloud's identity boundary PINNED X-Org-Id to the token's OWN owner — so this call
	// would silently read/write another tenant's Cloudflare account. Refuse LOUD.
	if (response.ok) {
		const acting = response.headers.get("X-Hanzo-Org");
		if (acting !== org) {
			throw new Error(
				acting
					? `Cloudflare Pages tenant mismatch: cloud served org '${acting}' but '${org}' was requested — HANZO_CLOUD_API_TOKEN is not org-switch-capable (must be a SuperAdmin token); refusing to comingle tenants`
					: "Cloudflare Pages: cloud did not confirm the acting org (X-Hanzo-Org missing); refusing to proceed",
			);
		}
	}

	if (response.status === 204) return {} as T;

	const text = await response.text();
	if (!response.ok) {
		let message = text;
		try {
			const parsed = JSON.parse(text) as { error?: string; message?: string };
			message = parsed.error ?? parsed.message ?? text;
		} catch {
			// keep the raw text
		}
		throw new Error(
			`Cloudflare Pages API error (${response.status}): ${message || response.statusText}`,
		);
	}
	return (text ? JSON.parse(text) : {}) as T;
}

/** List the org's Pages projects. */
export function listPagesProjects(org: string): Promise<CloudflarePagesProject[]> {
	return cloudPagesFetch<CloudflarePagesProject[]>(org, "/projects");
}

/** Get one of the org's Pages projects by name. */
export function getPagesProject(
	org: string,
	projectName: string,
): Promise<CloudflarePagesProject> {
	return cloudPagesFetch<CloudflarePagesProject>(
		org,
		`/projects/${encodeURIComponent(projectName)}`,
	);
}

/** Create a Pages project in the org's connected Cloudflare account. */
export function createPagesProject(
	org: string,
	project: PagesProjectCreateParams,
): Promise<CloudflarePagesProject> {
	return cloudPagesFetch<CloudflarePagesProject>(org, "/projects", {
		method: "POST",
		body: project,
	});
}

/** Trigger a deployment for one of the org's Pages projects. */
export function createPagesDeployment(
	org: string,
	projectName: string,
	branch?: string,
): Promise<CloudflarePagesDeployment> {
	return cloudPagesFetch<CloudflarePagesDeployment>(
		org,
		`/projects/${encodeURIComponent(projectName)}/deployments`,
		{ method: "POST", body: branch ? { branch } : undefined },
	);
}

/** Add a custom domain to one of the org's Pages projects. */
export function addPagesCustomDomain(
	org: string,
	projectName: string,
	domain: string,
): Promise<CloudflarePagesCustomDomain> {
	return cloudPagesFetch<CloudflarePagesCustomDomain>(
		org,
		`/projects/${encodeURIComponent(projectName)}/domains`,
		{ method: "POST", body: { name: domain } },
	);
}

/** Remove a custom domain from one of the org's Pages projects. */
export function removePagesCustomDomain(
	org: string,
	projectName: string,
	domain: string,
): Promise<void> {
	return cloudPagesFetch<void>(
		org,
		`/projects/${encodeURIComponent(projectName)}/domains/${encodeURIComponent(domain)}`,
		{ method: "DELETE" },
	);
}
