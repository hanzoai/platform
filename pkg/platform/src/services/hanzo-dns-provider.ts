/**
 * Hanzo DNS Provider
 *
 * Implements the DnsProvider interface against the hanzoai/dns control plane
 * (CoreDNS + the `hanzodns` plugin) REST API at `dns.hanzo.ai/v1/dns`. The
 * control plane owns the upstream provider details per org: an `authoritative`
 * zone is served from CoreDNS in-cluster; a `cloudflare`-connected zone's records
 * are created in Cloudflare via that org's KMS-sealed connector token. The
 * platform never talks to Cloudflare directly — it manages every zone/record
 * through this ONE per-org control plane.
 *
 * Contract (hanzodns plugin `api.go`/`store.go`), plain REST — NOT a `{data}`
 * envelope:
 *   GET    /v1/dns/zones                       -> { zones, total }
 *   POST   /v1/dns/zones            {zone}      -> Zone
 *   GET    /v1/dns/zones/{zone}                 -> Zone
 *   DELETE /v1/dns/zones/{zone}                 -> {}
 *   GET    /v1/dns/zones/{zone}/records         -> { records, total }
 *   POST   /v1/dns/zones/{zone}/records {…}     -> Record
 *   PATCH  /v1/dns/zones/{zone}/records/{id} {…}-> Record
 *   DELETE /v1/dns/zones/{zone}/records/{id}    -> {}
 *
 * Zones are keyed by NAME (the FQDN the store keys on), not an opaque id — so the
 * `zoneId` the interface passes for record operations is the zone name. Config is
 * read from the environment:
 *   - HANZO_DNS_API_KEY / HANZO_DNS_API_TOKEN: bearer token
 *   - HANZO_DNS_API_URL:                       base URL (default https://dns.hanzo.ai)
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
/** All routes live under the unified `/v1/dns` surface (no `/api/` prefix). */
const API_PREFIX = "/v1/dns";

export interface HanzoDnsConfig {
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
 * Generic fetch wrapper for the Hanzo DNS API. Returns the parsed JSON body
 * verbatim (the plane is plain REST, NOT a `{data}` envelope — each caller
 * unwraps its own `{zones}` / `{records}` shape or bare object). Throws on a
 * non-2xx, surfacing the `{code,message}` (or `{error}`) reason.
 */
async function hanzoDnsFetch(
	config: HanzoDnsConfig,
	path: string,
	options: { method?: string; body?: unknown } = {},
): Promise<unknown> {
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
		return {};
	}

	if (!response.ok) {
		let errorMessage: string;
		try {
			const errorBody = (await response.json()) as {
				code?: string;
				error?: string;
				message?: string;
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

	// A 200 with an empty/whitespace body (e.g. delete → `{}`) parses safely.
	const text = await response.text();
	if (!text.trim()) return {};
	return JSON.parse(text);
}

// ============================================================================
// API Response Types (hanzodns `store.go` shapes)
// ============================================================================

interface HanzoDnsZone {
	id: string;
	/** FQDN the store keys the zone on, e.g. `example.com.`. */
	zone: string;
	status: string;
	nameservers: string[];
	record_count: number;
	dnssec_enabled: boolean;
	/** `authoritative` | `cloudflare` | … — the backend that serves this zone. */
	provider?: string;
	created_at: string;
	updated_at: string;
}

interface HanzoDnsRecord {
	id: string;
	name: string;
	type: string;
	content: string;
	ttl: number;
	proxied?: boolean;
	priority?: number;
	created_at: string;
	updated_at: string;
}

// ============================================================================
// Type Mapping
// ============================================================================

/** The platform surfaces every hanzodns-served zone under the `hanzo` provider
 *  (the control plane); the zone's internal `authoritative`/`cloudflare` backend
 *  is a hanzodns detail, not the platform provider type. */
function mapZone(zone: HanzoDnsZone): DnsZone {
	return {
		// Records are addressed by zone NAME; expose it as the id so the interface's
		// `zoneId` round-trips to the correct `/v1/dns/zones/{name}/records` path.
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

/** Unwrap `{ zones, total }` (or a bare array) into rows. */
function zoneRows(payload: unknown): HanzoDnsZone[] {
	if (Array.isArray(payload)) return payload as HanzoDnsZone[];
	const rows = (payload as { zones?: unknown } | null)?.zones;
	return Array.isArray(rows) ? (rows as HanzoDnsZone[]) : [];
}

/** Unwrap `{ records, total }` (or a bare array) into rows. */
function recordRows(payload: unknown): HanzoDnsRecord[] {
	if (Array.isArray(payload)) return payload as HanzoDnsRecord[];
	const rows = (payload as { records?: unknown } | null)?.records;
	return Array.isArray(rows) ? (rows as HanzoDnsRecord[]) : [];
}

/** Path segment for a zone/record id (dots pass through; encodes anything odd). */
const seg = (s: string): string => encodeURIComponent(s);

// ============================================================================
// Provider Implementation
// ============================================================================

export class HanzoDnsProvider implements DnsProvider {
	readonly type: DnsProviderType = "hanzo";

	/** `configOverride` is a test seam only; production always resolves from env. */
	constructor(private readonly configOverride?: HanzoDnsConfig) {}

	private get config() {
		return this.configOverride ?? getHanzoDnsConfig();
	}

	async listZones(): Promise<DnsZone[]> {
		const payload = await hanzoDnsFetch(this.config, `${API_PREFIX}/zones`);
		return zoneRows(payload).map(mapZone);
	}

	async getZone(zoneName: string): Promise<DnsZone> {
		const zone = (await hanzoDnsFetch(
			this.config,
			`${API_PREFIX}/zones/${seg(zoneName)}`,
		)) as HanzoDnsZone;
		return mapZone(zone);
	}

	async createZone(name: string): Promise<DnsZone> {
		const zone = (await hanzoDnsFetch(this.config, `${API_PREFIX}/zones`, {
			method: "POST",
			body: { zone: name.replace(/\.$/, "") },
		})) as HanzoDnsZone;
		return mapZone(zone);
	}

	async deleteZone(zoneName: string): Promise<void> {
		await hanzoDnsFetch(this.config, `${API_PREFIX}/zones/${seg(zoneName)}`, {
			method: "DELETE",
		});
	}

	async listRecords(zoneName: string): Promise<DnsRecord[]> {
		const payload = await hanzoDnsFetch(
			this.config,
			`${API_PREFIX}/zones/${seg(zoneName)}/records`,
		);
		return recordRows(payload).map((r) => mapRecord(zoneName, r));
	}

	async createRecord(
		zoneName: string,
		record: DnsProviderRecordCreateParams,
	): Promise<DnsRecord> {
		const created = (await hanzoDnsFetch(
			this.config,
			`${API_PREFIX}/zones/${seg(zoneName)}/records`,
			{
				method: "POST",
				body: {
					name: record.name,
					type: record.type,
					content: record.content,
					ttl: record.ttl,
					priority: record.priority,
					proxied: record.proxied,
				},
			},
		)) as HanzoDnsRecord;
		return mapRecord(zoneName, created);
	}

	async updateRecord(
		zoneName: string,
		recordId: string,
		record: DnsProviderRecordUpdateParams,
	): Promise<DnsRecord> {
		// PATCH = partial update (the store applies only non-nil fields), so an
		// edit never clobbers a field the caller didn't set.
		const updated = (await hanzoDnsFetch(
			this.config,
			`${API_PREFIX}/zones/${seg(zoneName)}/records/${seg(recordId)}`,
			{
				method: "PATCH",
				body: {
					name: record.name,
					type: record.type,
					content: record.content,
					ttl: record.ttl,
					priority: record.priority,
					proxied: record.proxied,
				},
			},
		)) as HanzoDnsRecord;
		return mapRecord(zoneName, updated);
	}

	async deleteRecord(zoneName: string, recordId: string): Promise<void> {
		await hanzoDnsFetch(
			this.config,
			`${API_PREFIX}/zones/${seg(zoneName)}/records/${seg(recordId)}`,
			{ method: "DELETE" },
		);
	}
}
