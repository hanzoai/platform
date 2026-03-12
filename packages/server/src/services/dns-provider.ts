/**
 * DNS Provider Abstraction
 *
 * Defines a canonical interface for DNS zone and record management across
 * multiple providers (Cloudflare, Hanzo DNS). Each provider implements
 * the DnsProvider interface, mapping provider-specific APIs to a unified
 * set of types and operations.
 */

// ============================================================================
// Provider Type
// ============================================================================

export type DnsProviderType = "cloudflare" | "hanzo";

// ============================================================================
// Canonical Types
// ============================================================================

export interface DnsZone {
	id: string;
	name: string;
	status: string;
	provider: DnsProviderType;
	nameServers: string[];
	createdAt: string;
	modifiedAt: string;
}

export interface DnsRecord {
	id: string;
	zoneId: string;
	name: string;
	type: string;
	content: string;
	ttl: number;
	proxied?: boolean;
	priority?: number;
	provider: DnsProviderType;
	createdAt: string;
	modifiedAt: string;
}

export interface DnsProviderRecordCreateParams {
	type: string;
	name: string;
	content: string;
	ttl?: number;
	proxied?: boolean;
	priority?: number;
	comment?: string;
}

export interface DnsProviderRecordUpdateParams {
	type?: string;
	name?: string;
	content?: string;
	ttl?: number;
	proxied?: boolean;
	priority?: number;
	comment?: string;
}

export interface DnsVerifyResult {
	resolved: boolean;
	addresses: string[];
	matches: boolean;
	message: string;
}

// ============================================================================
// Provider Interface
// ============================================================================

export interface DnsProvider {
	readonly type: DnsProviderType;

	listZones(): Promise<DnsZone[]>;
	getZone(zoneId: string): Promise<DnsZone>;
	createZone(name: string): Promise<DnsZone>;
	deleteZone(zoneId: string): Promise<void>;

	listRecords(zoneId: string): Promise<DnsRecord[]>;
	createRecord(zoneId: string, record: DnsProviderRecordCreateParams): Promise<DnsRecord>;
	updateRecord(zoneId: string, recordId: string, record: DnsProviderRecordUpdateParams): Promise<DnsRecord>;
	deleteRecord(zoneId: string, recordId: string): Promise<void>;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a DNS provider instance by type.
 *
 * Lazily imports the provider module to avoid loading both providers
 * when only one is needed.
 */
export async function createDnsProvider(type: DnsProviderType): Promise<DnsProvider> {
	switch (type) {
		case "cloudflare": {
			const { CloudflareDnsProvider } = await import("./cloudflare-dns-provider");
			return new CloudflareDnsProvider();
		}
		case "hanzo": {
			const { HanzoDnsProvider } = await import("./hanzo-dns-provider");
			return new HanzoDnsProvider();
		}
		default:
			throw new Error(`Unknown DNS provider type: ${type satisfies never}`);
	}
}
