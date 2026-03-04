/**
 * Hanzo DNS Provider
 *
 * Implements the DnsProvider interface by calling the Hanzo DNS REST API
 * at dns.hanzo.ai. Works with any upstream DNS provider the org has
 * configured (Cloudflare, Route53, etc.) -- the Hanzo DNS service
 * abstracts the provider details.
 *
 * Configuration is read from environment variables:
 *   - HANZO_DNS_API_KEY:   bearer token (preferred)
 *   - HANZO_DNS_API_TOKEN: bearer token (legacy alias)
 *   - HANZO_DNS_API_URL:   base URL (default: https://dns.hanzo.ai)
 */

import type {
	DnsProvider,
	DnsProviderRecordCreateParams,
	DnsProviderRecordUpdateParams,
	DnsProviderType,
	DnsRecord,
	DnsZone,
} from "./dns-provider";

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_BASE_URL = "https://dns.hanzo.ai";

interface HanzoDnsConfig {
	baseUrl: string;
	apiToken: string;
}

export function getHanzoDnsConfig(): HanzoDnsConfig {
	const apiToken =
		process.env.HANZO_DNS_API_KEY ?? process.env.HANZO_DNS_API_TOKEN;
	if (!apiToken) {
		throw new Error(
			"HANZO_DNS_API_KEY (or HANZO_DNS_API_TOKEN) environment variable is required",
		);
	}

	return {
		baseUrl: process.env.HANZO_DNS_API_URL ?? DEFAULT_BASE_URL,
		apiToken,
	};
}

/**
 * Returns true when Hanzo DNS credentials are available.
 */
export function isHanzoDnsConfigured(): boolean {
	return Boolean(
		process.env.HANZO_DNS_API_KEY ?? process.env.HANZO_DNS_API_TOKEN,
	);
}

// ============================================================================
// API Client
// ============================================================================

interface HanzoDnsApiResponse<T> {
	data: T;
	error?: string;
}

/**
 * Generic fetch wrapper for the Hanzo DNS API.
 *
 * Handles authentication, JSON serialization, and error unwrapping.
 * Throws on non-2xx responses or API-level errors.
 */
async function hanzoDnsFetch<T>(
	config: HanzoDnsConfig,
	path: string,
	options: { method?: string; body?: unknown } = {},
): Promise<T> {
	const { method = "GET", body } = options;

	const url = `${config.baseUrl}${path}`;
	const headers: Record<string, string> = {
		Authorization: `Bearer ${config.apiToken}`,
		"Content-Type": "application/json",
	};

	const response = await fetch(url, {
		method,
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});

	if (response.status === 204) {
		return {} as T;
	}

	if (!response.ok) {
		let errorMessage: string;
		try {
			const errorBody = (await response.json()) as {
				error?: string;
				message?: string;
			};
			errorMessage =
				errorBody.error ?? errorBody.message ?? response.statusText;
		} catch {
			errorMessage = response.statusText;
		}
		throw new Error(
			`Hanzo DNS API error (${response.status}): ${errorMessage}`,
		);
	}

	const json = (await response.json()) as HanzoDnsApiResponse<T>;
	if (json.error) {
		throw new Error(`Hanzo DNS API error: ${json.error}`);
	}

	return json.data;
}

// ============================================================================
// API Response Types
// ============================================================================

interface HanzoDnsZone {
	id: string;
	name: string;
	status: string;
	name_servers: string[];
	created_at: string;
	modified_at: string;
}

interface HanzoDnsRecord {
	id: string;
	zone_id: string;
	name: string;
	type: string;
	content: string;
	ttl: number;
	proxied?: boolean;
	priority?: number;
	created_at: string;
	modified_at: string;
}

// ============================================================================
// Type Mapping
// ============================================================================

function mapZone(zone: HanzoDnsZone): DnsZone {
	return {
		id: zone.id,
		name: zone.name,
		status: zone.status,
		provider: "hanzo" as DnsProviderType,
		nameServers: zone.name_servers,
		createdAt: zone.created_at,
		modifiedAt: zone.modified_at,
	};
}

function mapRecord(record: HanzoDnsRecord): DnsRecord {
	return {
		id: record.id,
		zoneId: record.zone_id,
		name: record.name,
		type: record.type,
		content: record.content,
		ttl: record.ttl,
		proxied: record.proxied,
		priority: record.priority,
		provider: "hanzo" as DnsProviderType,
		createdAt: record.created_at,
		modifiedAt: record.modified_at,
	};
}

// ============================================================================
// Provider Implementation
// ============================================================================

export class HanzoDnsProvider implements DnsProvider {
	readonly type: DnsProviderType = "hanzo";

	private get config() {
		return getHanzoDnsConfig();
	}

	async listZones(): Promise<DnsZone[]> {
		const zones = await hanzoDnsFetch<HanzoDnsZone[]>(
			this.config,
			"/api/v1/zones",
		);
		return zones.map(mapZone);
	}

	async getZone(zoneId: string): Promise<DnsZone> {
		const zone = await hanzoDnsFetch<HanzoDnsZone>(
			this.config,
			`/api/v1/zones/${zoneId}`,
		);
		return mapZone(zone);
	}

	async createZone(name: string): Promise<DnsZone> {
		const zone = await hanzoDnsFetch<HanzoDnsZone>(
			this.config,
			"/api/v1/zones",
			{ method: "POST", body: { name } },
		);
		return mapZone(zone);
	}

	async deleteZone(zoneId: string): Promise<void> {
		await hanzoDnsFetch<unknown>(this.config, `/api/v1/zones/${zoneId}`, {
			method: "DELETE",
		});
	}

	async listRecords(zoneId: string): Promise<DnsRecord[]> {
		const records = await hanzoDnsFetch<HanzoDnsRecord[]>(
			this.config,
			`/api/v1/zones/${zoneId}/records`,
		);
		return records.map(mapRecord);
	}

	async createRecord(
		zoneId: string,
		record: DnsProviderRecordCreateParams,
	): Promise<DnsRecord> {
		const created = await hanzoDnsFetch<HanzoDnsRecord>(
			this.config,
			`/api/v1/zones/${zoneId}/records`,
			{ method: "POST", body: record },
		);
		return mapRecord(created);
	}

	async updateRecord(
		zoneId: string,
		recordId: string,
		record: DnsProviderRecordUpdateParams,
	): Promise<DnsRecord> {
		const updated = await hanzoDnsFetch<HanzoDnsRecord>(
			this.config,
			`/api/v1/zones/${zoneId}/records/${recordId}`,
			{ method: "PUT", body: record },
		);
		return mapRecord(updated);
	}

	async deleteRecord(zoneId: string, recordId: string): Promise<void> {
		await hanzoDnsFetch<unknown>(
			this.config,
			`/api/v1/zones/${zoneId}/records/${recordId}`,
			{ method: "DELETE" },
		);
	}
}
