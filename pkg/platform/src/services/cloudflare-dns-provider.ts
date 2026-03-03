/**
 * Cloudflare DNS Provider
 *
 * Implements the DnsProvider interface by wrapping the existing Cloudflare
 * service functions. Maps Cloudflare-specific response types to the
 * canonical DnsZone/DnsRecord types.
 */

import {
	getCloudflareConfig,
	listZones as cfListZones,
	getZone as cfGetZone,
	listDnsRecords as cfListDnsRecords,
	createDnsRecord as cfCreateDnsRecord,
	updateDnsRecord as cfUpdateDnsRecord,
	deleteDnsRecord as cfDeleteDnsRecord,
} from "./cloudflare";
import type { CloudflareZone, CloudflareDnsRecord } from "./cloudflare";
import type {
	DnsProvider,
	DnsProviderType,
	DnsZone,
	DnsRecord,
	DnsProviderRecordCreateParams,
	DnsProviderRecordUpdateParams,
} from "./dns-provider";
import type { DnsRecordType } from "./cloudflare";

// ============================================================================
// Type Mapping
// ============================================================================

function mapZone(zone: CloudflareZone): DnsZone {
	return {
		id: zone.id,
		name: zone.name,
		status: zone.status,
		provider: "cloudflare" as DnsProviderType,
		nameServers: zone.name_servers,
		createdAt: zone.created_on,
		modifiedAt: zone.modified_on,
	};
}

function mapRecord(record: CloudflareDnsRecord): DnsRecord {
	return {
		id: record.id,
		zoneId: record.zone_id,
		name: record.name,
		type: record.type,
		content: record.content,
		ttl: record.ttl,
		proxied: record.proxied,
		priority: record.priority,
		provider: "cloudflare" as DnsProviderType,
		createdAt: record.created_on,
		modifiedAt: record.modified_on,
	};
}

// ============================================================================
// Provider Implementation
// ============================================================================

export class CloudflareDnsProvider implements DnsProvider {
	readonly type: DnsProviderType = "cloudflare";

	private get config() {
		return getCloudflareConfig();
	}

	async listZones(): Promise<DnsZone[]> {
		const zones = await cfListZones(this.config.apiToken);
		return zones.map(mapZone);
	}

	async getZone(zoneId: string): Promise<DnsZone> {
		const zone = await cfGetZone(this.config.apiToken, zoneId);
		return mapZone(zone);
	}

	async createZone(_name: string): Promise<DnsZone> {
		throw new Error(
			"Zone creation is not supported via the Cloudflare API for most plan types. " +
			"Add zones through the Cloudflare dashboard instead.",
		);
	}

	async deleteZone(_zoneId: string): Promise<void> {
		throw new Error(
			"Zone deletion is not supported via the Cloudflare API for most plan types. " +
			"Remove zones through the Cloudflare dashboard instead.",
		);
	}

	async listRecords(zoneId: string): Promise<DnsRecord[]> {
		const records = await cfListDnsRecords(this.config.apiToken, zoneId);
		return records.map(mapRecord);
	}

	async createRecord(zoneId: string, record: DnsProviderRecordCreateParams): Promise<DnsRecord> {
		const cfRecord = await cfCreateDnsRecord(this.config.apiToken, zoneId, {
			type: record.type as DnsRecordType,
			name: record.name,
			content: record.content,
			ttl: record.ttl,
			proxied: record.proxied,
			priority: record.priority,
			comment: record.comment,
		});
		return mapRecord(cfRecord);
	}

	async updateRecord(
		zoneId: string,
		recordId: string,
		record: DnsProviderRecordUpdateParams,
	): Promise<DnsRecord> {
		const cfRecord = await cfUpdateDnsRecord(this.config.apiToken, zoneId, recordId, {
			type: record.type as DnsRecordType | undefined,
			name: record.name,
			content: record.content,
			ttl: record.ttl,
			proxied: record.proxied,
			priority: record.priority,
			comment: record.comment,
		});
		return mapRecord(cfRecord);
	}

	async deleteRecord(zoneId: string, recordId: string): Promise<void> {
		await cfDeleteDnsRecord(this.config.apiToken, zoneId, recordId);
	}
}
