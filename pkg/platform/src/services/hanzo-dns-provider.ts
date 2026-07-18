/**
 * Hanzo DNS Provider
 *
 * Implements the DnsProvider interface by calling the Hanzo DNS REST API at
 * dns.hanzo.ai (hanzoai/dns). The Hanzo DNS service is the ONE DNS control
 * plane: it serves authoritative zones from its own CoreDNS store and, for
 * provider-backed zones, manages records in the org's connected upstream
 * (Cloudflare) via the org's KMS-sealed token — so this client works the same
 * whichever backend a zone uses.
 *
 * The deployed server is keyed by zone NAME (not an opaque zone id) and serves
 * everything under /v1/dns/* (no /api/ prefix). Its list endpoints return
 * `{zones|records, total}` and its item endpoints return the object directly —
 * there is no `{data}` envelope.
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

/**
 * Generic fetch wrapper for the Hanzo DNS API. Handles authentication, JSON
 * serialization, and error unwrapping. The server returns raw JSON (an object,
 * or `{zones|records, total}` for lists); errors are `{code, message}`. Throws
 * on non-2xx responses.
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
				message?: string;
				error?: string;
			};
			errorMessage =
				errorBody.message ?? errorBody.error ?? response.statusText;
		} catch {
			errorMessage = response.statusText;
		}
		throw new Error(
			`Hanzo DNS API error (${response.status}): ${errorMessage}`,
		);
	}

	return (await response.json()) as T;
}

// ============================================================================
// API Response Types (match the deployed server)
// ============================================================================

interface HanzoDnsZone {
	id: string;
	zone: string; // the zone NAME (FQDN with trailing dot) — the addressing key
	provider: string; // "authoritative" | "cloudflare"
	status: string;
	nameservers: string[];
	record_count: number;
	created_at: string;
	updated_at: string;
}

interface HanzoDnsRecord {
	id: string;
	name: string;
	type: string;
	content: string;
	ttl: number;
	proxied: boolean;
	priority?: number;
	created_at: string;
	updated_at: string;
}

// ============================================================================
// Type Mapping
// ============================================================================

function mapZone(zone: HanzoDnsZone): DnsZone {
	return {
		// The server addresses zones by NAME, so the canonical id IS the name —
		// subsequent getZone/listRecords/... calls pass it back as the key.
		id: zone.zone,
		name: zone.zone,
		status: zone.status,
		provider: "hanzo" as DnsProviderType,
		nameServers: zone.nameservers ?? [],
		createdAt: zone.created_at,
		modifiedAt: zone.updated_at,
	};
}

function mapRecord(zoneName: string, record: HanzoDnsRecord): DnsRecord {
	return {
		id: record.id,
		zoneId: zoneName,
		name: record.name,
		type: record.type,
		content: record.content,
		ttl: record.ttl,
		proxied: record.proxied,
		priority: record.priority,
		provider: "hanzo" as DnsProviderType,
		createdAt: record.created_at,
		modifiedAt: record.updated_at,
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
		const { zones } = await hanzoDnsFetch<{ zones: HanzoDnsZone[] }>(
			this.config,
			"/v1/dns/zones",
		);
		return (zones ?? []).map(mapZone);
	}

	async getZone(zoneId: string): Promise<DnsZone> {
		const zone = await hanzoDnsFetch<HanzoDnsZone>(
			this.config,
			`/v1/dns/zones/${encodeURIComponent(zoneId)}`,
		);
		return mapZone(zone);
	}

	async createZone(name: string): Promise<DnsZone> {
		const zone = await hanzoDnsFetch<HanzoDnsZone>(
			this.config,
			"/v1/dns/zones",
			{ method: "POST", body: { zone: name } },
		);
		return mapZone(zone);
	}

	async deleteZone(zoneId: string): Promise<void> {
		await hanzoDnsFetch<unknown>(
			this.config,
			`/v1/dns/zones/${encodeURIComponent(zoneId)}`,
			{ method: "DELETE" },
		);
	}

	async listRecords(zoneId: string): Promise<DnsRecord[]> {
		const { records } = await hanzoDnsFetch<{ records: HanzoDnsRecord[] }>(
			this.config,
			`/v1/dns/zones/${encodeURIComponent(zoneId)}/records`,
		);
		return (records ?? []).map((r) => mapRecord(zoneId, r));
	}

	async createRecord(
		zoneId: string,
		record: DnsProviderRecordCreateParams,
	): Promise<DnsRecord> {
		const created = await hanzoDnsFetch<HanzoDnsRecord>(
			this.config,
			`/v1/dns/zones/${encodeURIComponent(zoneId)}/records`,
			{ method: "POST", body: record },
		);
		return mapRecord(zoneId, created);
	}

	async updateRecord(
		zoneId: string,
		recordId: string,
		record: DnsProviderRecordUpdateParams,
	): Promise<DnsRecord> {
		const updated = await hanzoDnsFetch<HanzoDnsRecord>(
			this.config,
			`/v1/dns/zones/${encodeURIComponent(zoneId)}/records/${encodeURIComponent(recordId)}`,
			{ method: "PUT", body: record },
		);
		return mapRecord(zoneId, updated);
	}

	async deleteRecord(zoneId: string, recordId: string): Promise<void> {
		await hanzoDnsFetch<unknown>(
			this.config,
			`/v1/dns/zones/${encodeURIComponent(zoneId)}/records/${encodeURIComponent(recordId)}`,
			{ method: "DELETE" },
		);
	}
}
