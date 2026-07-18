/**
 * Cloudflare Service
 *
 * Handles all interactions with the Cloudflare API v4 for DNS management
 * and Cloudflare Pages deployment. Provides zone management, DNS record
 * CRUD, and Pages project lifecycle operations.
 *
 * Features:
 * - Zone listing and lookup
 * - DNS record management (create, read, update, delete)
 * - Cloudflare Pages project management
 * - Pages deployment lifecycle
 * - Pages custom domain binding
 */

// ============================================================================
// Types — Cloudflare API v4 Response Envelope
// ============================================================================

interface CloudflareApiResponse<T> {
	success: boolean;
	errors: CloudflareApiError[];
	messages: CloudflareApiMessage[];
	result: T;
	result_info?: CloudflarePaginationInfo;
}

interface CloudflareApiError {
	code: number;
	message: string;
	source?: string;
}

interface CloudflareApiMessage {
	code: number;
	message: string;
}

interface CloudflarePaginationInfo {
	page: number;
	per_page: number;
	total_pages: number;
	count: number;
	total_count: number;
}

// ============================================================================
// Types — Zones
// ============================================================================

export interface CloudflareZone {
	id: string;
	name: string;
	status: "active" | "pending" | "initializing" | "moved" | "deleted" | "deactivated" | "read only";
	paused: boolean;
	type: "full" | "partial" | "secondary";
	development_mode: number;
	name_servers: string[];
	original_name_servers: string[];
	original_registrar: string | null;
	original_dnshost: string | null;
	modified_on: string;
	created_on: string;
	activated_on: string;
	account: {
		id: string;
		name: string;
	};
	permissions: string[];
	plan: {
		id: string;
		name: string;
		price: number;
		currency: string;
		frequency: string;
		is_subscribed: boolean;
		can_subscribe: boolean;
		legacy_id: string;
	};
}

// ============================================================================
// Types — DNS Records
// ============================================================================

export type DnsRecordType =
	| "A"
	| "AAAA"
	| "CNAME"
	| "TXT"
	| "MX"
	| "NS"
	| "SRV"
	| "CAA"
	| "PTR"
	| "LOC"
	| "SPF"
	| "CERT"
	| "DNSKEY"
	| "DS"
	| "NAPTR"
	| "SMIMEA"
	| "SSHFP"
	| "TLSA"
	| "URI";

export interface CloudflareDnsRecord {
	id: string;
	zone_id: string;
	zone_name: string;
	name: string;
	type: DnsRecordType;
	content: string;
	proxiable: boolean;
	proxied: boolean;
	ttl: number;
	locked: boolean;
	meta: {
		auto_added: boolean;
		managed_by_apps: boolean;
		managed_by_argo_tunnel: boolean;
		source: string;
	};
	comment: string | null;
	tags: string[];
	created_on: string;
	modified_on: string;
	priority?: number;
}

export interface DnsRecordCreateParams {
	type: DnsRecordType;
	name: string;
	content: string;
	ttl?: number;
	proxied?: boolean;
	priority?: number;
	comment?: string;
	tags?: string[];
}

export interface DnsRecordUpdateParams {
	type?: DnsRecordType;
	name?: string;
	content?: string;
	ttl?: number;
	proxied?: boolean;
	priority?: number;
	comment?: string;
	tags?: string[];
}

export interface DnsRecordListParams {
	type?: DnsRecordType;
	name?: string;
	content?: string;
	comment?: string;
	tag?: string;
	page?: number;
	per_page?: number;
	order?: "type" | "name" | "content" | "ttl" | "proxied";
	direction?: "asc" | "desc";
	match?: "any" | "all";
}

// ============================================================================
// Types — Pages
// ============================================================================

export interface CloudflarePagesProject {
	id: string;
	name: string;
	subdomain: string;
	domains: string[];
	source?: {
		type: string;
		config: {
			owner: string;
			repo_name: string;
			production_branch: string;
			pr_comments_enabled: boolean;
			deployments_enabled: boolean;
			production_deployments_enabled: boolean;
			preview_deployment_setting: "all" | "none" | "custom";
			preview_branch_includes: string[];
			preview_branch_excludes: string[];
		};
	};
	build_config: {
		build_command: string;
		destination_dir: string;
		root_dir: string;
		web_analytics_tag?: string;
		web_analytics_token?: string;
	};
	deployment_configs: {
		preview: PagesDeploymentConfig;
		production: PagesDeploymentConfig;
	};
	latest_deployment?: CloudflarePagesDeployment;
	canonical_deployment?: CloudflarePagesDeployment;
	production_branch: string;
	created_on: string;
	modified_on: string;
}

export interface PagesDeploymentConfig {
	compatibility_date?: string;
	compatibility_flags?: string[];
	env_vars?: Record<string, { value: string; type?: "plain_text" | "secret_text" }>;
	kv_namespaces?: Record<string, { namespace_id: string }>;
	durable_object_namespaces?: Record<string, { namespace_id: string }>;
	d1_databases?: Record<string, { id: string }>;
	r2_buckets?: Record<string, { name: string }>;
	services?: Record<string, { service: string; environment: string }>;
	placement?: { mode: string };
}

export interface CloudflarePagesDeployment {
	id: string;
	short_id: string;
	project_id: string;
	project_name: string;
	environment: "production" | "preview";
	url: string;
	latest_stage: {
		name: string;
		started_on: string | null;
		ended_on: string | null;
		status: "idle" | "active" | "canceled" | "success" | "failure";
	};
	deployment_trigger: {
		type: string;
		metadata: {
			branch: string;
			commit_hash: string;
			commit_message: string;
			commit_dirty: boolean;
		};
	};
	stages: Array<{
		name: string;
		started_on: string | null;
		ended_on: string | null;
		status: "idle" | "active" | "canceled" | "success" | "failure";
	}>;
	build_config: {
		build_command: string;
		destination_dir: string;
		root_dir: string;
	};
	source: {
		type: string;
		config: {
			owner: string;
			repo_name: string;
		};
	};
	aliases: string[];
	production_branch: string;
	created_on: string;
	modified_on: string;
}

export interface PagesProjectCreateParams {
	name: string;
	production_branch?: string;
	build_config?: {
		build_command?: string;
		destination_dir?: string;
		root_dir?: string;
	};
	deployment_configs?: {
		preview?: PagesDeploymentConfig;
		production?: PagesDeploymentConfig;
	};
}

export interface CloudflarePagesCustomDomain {
	id: string;
	name: string;
	status: "active" | "pending" | "deactivated" | "blocked" | "error";
	verification_type: string;
	verification_data: Record<string, string>;
	created_on: string;
}

// ============================================================================
// Configuration
// ============================================================================

interface CloudflareConfig {
	apiToken: string;
	zoneId: string;
	accountId: string;
}

export function getCloudflareConfig(): CloudflareConfig {
	const apiToken = process.env.CLOUDFLARE_API_TOKEN;
	if (!apiToken) {
		throw new Error("CLOUDFLARE_API_TOKEN environment variable is required");
	}

	const zoneId = process.env.CLOUDFLARE_ZONE_ID;
	if (!zoneId) {
		throw new Error("CLOUDFLARE_ZONE_ID environment variable is required");
	}

	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
	if (!accountId) {
		throw new Error("CLOUDFLARE_ACCOUNT_ID environment variable is required");
	}

	return { apiToken, zoneId, accountId };
}

// ============================================================================
// API Client — Generic Fetch Wrapper
// ============================================================================

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

interface CfFetchOptions extends Omit<RequestInit, "body"> {
	body?: unknown;
	params?: Record<string, string | number | boolean | undefined>;
}

/**
 * Generic Cloudflare API v4 fetch wrapper.
 *
 * Handles authentication, JSON serialization, query parameter encoding,
 * and unwraps the CF response envelope ({ success, result, errors }).
 * Throws on API-level errors or non-2xx HTTP status.
 */
export async function cfFetch<T>(
	apiToken: string,
	path: string,
	options: CfFetchOptions = {},
): Promise<T> {
	const { body, params, headers: extraHeaders, ...fetchOpts } = options;

	// Build URL with query parameters
	let url = `${CF_API_BASE}${path}`;
	if (params) {
		const searchParams = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined) {
				searchParams.set(key, String(value));
			}
		}
		const qs = searchParams.toString();
		if (qs) {
			url = `${url}?${qs}`;
		}
	}

	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiToken}`,
		"Content-Type": "application/json",
		...(extraHeaders as Record<string, string>),
	};

	const response = await fetch(url, {
		...fetchOpts,
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});

	// Handle 204 No Content (e.g. successful DELETE)
	if (response.status === 204) {
		return {} as T;
	}

	const json = (await response.json()) as CloudflareApiResponse<T>;

	if (!json.success) {
		const errorMessages = json.errors
			.map((e) => `[${e.code}] ${e.message}`)
			.join("; ");
		throw new Error(
			`Cloudflare API error (${response.status}): ${errorMessages || response.statusText}`,
		);
	}

	return json.result;
}

// ============================================================================
// Zone Management
// ============================================================================

/**
 * List all zones accessible to the authenticated token.
 */
export async function listZones(
	apiToken: string,
	params?: { name?: string; status?: string; page?: number; per_page?: number },
): Promise<CloudflareZone[]> {
	return cfFetch<CloudflareZone[]>(apiToken, "/zones", { params });
}

/**
 * Get details for a single zone by ID.
 */
export async function getZone(
	apiToken: string,
	zoneId: string,
): Promise<CloudflareZone> {
	return cfFetch<CloudflareZone>(apiToken, `/zones/${zoneId}`);
}

// ============================================================================
// DNS Record Management
// ============================================================================

/**
 * List DNS records for a zone with optional filtering.
 */
export async function listDnsRecords(
	apiToken: string,
	zoneId: string,
	params?: DnsRecordListParams,
): Promise<CloudflareDnsRecord[]> {
	return cfFetch<CloudflareDnsRecord[]>(
		apiToken,
		`/zones/${zoneId}/dns_records`,
		{ params: params as Record<string, string | number | boolean | undefined> },
	);
}

/**
 * Create a new DNS record in a zone.
 */
export async function createDnsRecord(
	apiToken: string,
	zoneId: string,
	record: DnsRecordCreateParams,
): Promise<CloudflareDnsRecord> {
	return cfFetch<CloudflareDnsRecord>(
		apiToken,
		`/zones/${zoneId}/dns_records`,
		{ method: "POST", body: record },
	);
}

/**
 * Update an existing DNS record (partial update via PATCH).
 */
export async function updateDnsRecord(
	apiToken: string,
	zoneId: string,
	recordId: string,
	record: DnsRecordUpdateParams,
): Promise<CloudflareDnsRecord> {
	return cfFetch<CloudflareDnsRecord>(
		apiToken,
		`/zones/${zoneId}/dns_records/${recordId}`,
		{ method: "PATCH", body: record },
	);
}

/**
 * Delete a DNS record from a zone.
 */
export async function deleteDnsRecord(
	apiToken: string,
	zoneId: string,
	recordId: string,
): Promise<{ id: string }> {
	return cfFetch<{ id: string }>(
		apiToken,
		`/zones/${zoneId}/dns_records/${recordId}`,
		{ method: "DELETE" },
	);
}

// ============================================================================
// Convenience Wrappers (use env-based config)
// ============================================================================

/**
 * Create a DNS record using the default zone from environment config.
 * Convenience wrapper for the most common use case.
 */
export async function createDnsRecordForDefaultZone(
	record: DnsRecordCreateParams,
): Promise<CloudflareDnsRecord> {
	const config = getCloudflareConfig();
	return createDnsRecord(config.apiToken, config.zoneId, record);
}

/**
 * List DNS records in the default zone from environment config.
 * Convenience wrapper for the most common use case.
 */
export async function listDnsRecordsForDefaultZone(
	params?: DnsRecordListParams,
): Promise<CloudflareDnsRecord[]> {
	const config = getCloudflareConfig();
	return listDnsRecords(config.apiToken, config.zoneId, params);
}

/**
 * Update a DNS record in the default zone from environment config.
 */
export async function updateDnsRecordForDefaultZone(
	recordId: string,
	record: DnsRecordUpdateParams,
): Promise<CloudflareDnsRecord> {
	const config = getCloudflareConfig();
	return updateDnsRecord(config.apiToken, config.zoneId, recordId, record);
}

/**
 * Delete a DNS record from the default zone from environment config.
 */
export async function deleteDnsRecordForDefaultZone(
	recordId: string,
): Promise<{ id: string }> {
	const config = getCloudflareConfig();
	return deleteDnsRecord(config.apiToken, config.zoneId, recordId);
}

