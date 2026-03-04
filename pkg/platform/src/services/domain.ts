import dns from "node:dns";
import { promisify } from "node:util";
import { db } from "@hanzo/platform/db";
import { getWebServerSettings } from "@hanzo/platform/services/web-server-settings";
import { generateRandomDomain } from "@hanzo/platform/templates";
import { manageDomain } from "@hanzo/platform/utils/traefik/domain";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { type apiCreateDomain, domains } from "../db/schema";
import { findApplicationById } from "./application";
import { detectCDNProvider } from "./cdn";
import {
	createDnsRecordForDefaultZone,
	deleteDnsRecordForDefaultZone,
	listDnsRecordsForDefaultZone,
} from "./cloudflare";
import { createDnsProvider, type DnsProviderType } from "./dns-provider";
import { isHanzoDnsConfigured } from "./hanzo-dns-provider";
import { findServerById } from "./server";

export type Domain = typeof domains.$inferSelect;

// ============================================================================
// DNS Provider Detection
// ============================================================================

const isCloudflareConfigured = (): boolean =>
	Boolean(
		process.env.CLOUDFLARE_API_TOKEN &&
			process.env.CLOUDFLARE_ZONE_ID &&
			process.env.CLOUDFLARE_ACCOUNT_ID,
	);

/**
 * Detect which DNS provider to use.
 * Prefers Hanzo DNS (multi-provider, dns.hanzo.ai) over direct Cloudflare.
 * Returns null when no provider is configured.
 */
const detectDnsProviderType = (): DnsProviderType | null => {
	if (isHanzoDnsConfigured()) return "hanzo";
	if (isCloudflareConfigured()) return "cloudflare";
	return null;
};

// ============================================================================
// Zone Matching Helper
// ============================================================================

/**
 * Find the zone whose name is the longest suffix of `host`.
 * E.g. host "app.staging.hanzo.ai" matches zone "hanzo.ai".
 */
function findMatchingZone(
	zones: Array<{ id: string; name: string }>,
	host: string,
): { id: string; name: string } | undefined {
	const normalized = host.toLowerCase();
	return zones
		.filter((z) => normalized === z.name || normalized.endsWith(`.${z.name}`))
		.sort((a, b) => b.name.length - a.name.length)[0];
}

// ============================================================================
// DNS Auto-Sync (create / delete)
// ============================================================================

/**
 * Create a DNS A record pointing `host` to `serverIp`.
 *
 * When HANZO_DNS_API_KEY is set, uses the Hanzo DNS API (dns.hanzo.ai) which
 * works with any upstream provider the org has configured.  Falls back to
 * direct Cloudflare API when only CLOUDFLARE_* vars are present.
 */
const syncDnsRecordCreate = async (
	host: string,
	serverIp: string,
): Promise<void> => {
	const providerType = detectDnsProviderType();
	if (!providerType) return;

	try {
		if (providerType === "hanzo") {
			const provider = await createDnsProvider("hanzo");
			const zones = await provider.listZones();
			const zone = findMatchingZone(zones, host);
			if (!zone) {
				console.warn(
					`[domain] No matching Hanzo DNS zone found for ${host}, skipping DNS sync`,
				);
				return;
			}
			await provider.createRecord(zone.id, {
				type: "A",
				name: host,
				content: serverIp,
				ttl: 1,
				proxied: true,
				comment: "Created by Hanzo Platform",
			});
		} else {
			await createDnsRecordForDefaultZone({
				type: "A",
				name: host,
				content: serverIp,
				ttl: 1,
				proxied: true,
				comment: "Created by Hanzo Platform",
			});
		}
	} catch (error) {
		console.error(
			`[domain] Failed to create DNS record for ${host} via ${providerType}:`,
			error instanceof Error ? error.message : error,
		);
	}
};

/**
 * Delete all DNS records matching `host`.
 *
 * Same provider-detection logic as syncDnsRecordCreate.
 */
const syncDnsRecordDelete = async (host: string): Promise<void> => {
	const providerType = detectDnsProviderType();
	if (!providerType) return;

	try {
		if (providerType === "hanzo") {
			const provider = await createDnsProvider("hanzo");
			const zones = await provider.listZones();
			const zone = findMatchingZone(zones, host);
			if (!zone) {
				console.warn(
					`[domain] No matching Hanzo DNS zone found for ${host}, skipping DNS delete`,
				);
				return;
			}
			const records = await provider.listRecords(zone.id);
			const matching = records.filter((r) => r.name === host);
			for (const record of matching) {
				await provider.deleteRecord(zone.id, record.id);
			}
		} else {
			const records = await listDnsRecordsForDefaultZone({ name: host });
			for (const record of records) {
				await deleteDnsRecordForDefaultZone(record.id);
			}
		}
	} catch (error) {
		console.error(
			`[domain] Failed to delete DNS record for ${host} via ${providerType}:`,
			error instanceof Error ? error.message : error,
		);
	}
};

export const createDomain = async (input: z.infer<typeof apiCreateDomain>) => {
	const result = await db.transaction(async (tx) => {
		const domain = await tx
			.insert(domains)
			.values({
				...input,
				host: input.host?.trim(),
			} as typeof domains.$inferInsert)
			.returning()
			.then((response) => response[0]);

		if (!domain) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Error creating domain",
			});
		}

		if (domain.applicationId) {
			const application = await findApplicationById(domain.applicationId);
			await manageDomain(application, domain);

			if (application.server?.ipAddress) {
				await syncDnsRecordCreate(domain.host, application.server.ipAddress);
			}
		}

		return domain;
	});

	return result;
};

export const generateTraefikMeDomain = async (
	appName: string,
	userId: string,
	serverId?: string,
) => {
	if (serverId) {
		const server = await findServerById(serverId);
		return generateRandomDomain({
			serverIp: server.ipAddress,
			projectName: appName,
		});
	}

	if (process.env.NODE_ENV === "development") {
		return generateRandomDomain({
			serverIp: "",
			projectName: appName,
		});
	}
	const settings = await getWebServerSettings();
	return generateRandomDomain({
		serverIp: settings?.serverIp || "",
		projectName: appName,
	});
};

export const generateWildcardDomain = (
	appName: string,
	serverDomain: string,
) => {
	return `${appName}-${serverDomain}`;
};

export const findDomainById = async (domainId: string) => {
	const domain = await db.query.domains.findFirst({
		where: eq(domains.domainId, domainId),
		with: {
			application: true,
		},
	});
	if (!domain) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Domain not found",
		});
	}
	return domain;
};

export const findDomainsByApplicationId = async (applicationId: string) => {
	const domainsArray = await db.query.domains.findMany({
		where: eq(domains.applicationId, applicationId),
		with: {
			application: true,
		},
	});

	return domainsArray;
};

export const findDomainsByComposeId = async (composeId: string) => {
	const domainsArray = await db.query.domains.findMany({
		where: eq(domains.composeId, composeId),
		with: {
			compose: true,
		},
	});

	return domainsArray;
};

export const updateDomainById = async (
	domainId: string,
	domainData: Partial<Domain>,
) => {
	const domain = await db
		.update(domains)
		.set({
			...domainData,
			...(domainData.host && { host: domainData.host.trim() }),
		})
		.where(eq(domains.domainId, domainId))
		.returning();

	return domain[0];
};

export const removeDomainById = async (domainId: string) => {
	const domain = await findDomainById(domainId);
	await syncDnsRecordDelete(domain.host);
	const result = await db
		.delete(domains)
		.where(eq(domains.domainId, domainId))
		.returning();

	return result[0];
};

export const getDomainHost = (domain: Domain) => {
	return `${domain.https ? "https" : "http"}://${domain.host}`;
};

const resolveDns = promisify(dns.resolve4);

export const validateDomain = async (
	domain: string,
	expectedIp?: string,
): Promise<{
	isValid: boolean;
	resolvedIp?: string;
	error?: string;
	isCloudflare?: boolean;
	cdnProvider?: string;
}> => {
	try {
		// Remove protocol and path if present
		const cleanDomain = domain.replace(/^https?:\/\//, "").split("/")[0];

		// Resolve the domain to get its IP
		const ips = await resolveDns(cleanDomain || "");

		const resolvedIps = ips.map((ip) => ip.toString());

		// Check if any IP belongs to a CDN provider
		const cdnProvider = ips
			.map((ip) => detectCDNProvider(ip))
			.find((provider) => provider !== null);

		// If behind a CDN, we consider it valid but inform the user
		if (cdnProvider) {
			return {
				isValid: true,
				resolvedIp: resolvedIps.join(", "),
				cdnProvider: cdnProvider.displayName,
				error: cdnProvider.warningMessage,
			};
		}

		// If we have an expected IP, validate against it
		if (expectedIp) {
			return {
				isValid: resolvedIps.includes(expectedIp),
				resolvedIp: resolvedIps.join(", "),
				error: !resolvedIps.includes(expectedIp)
					? `Domain resolves to ${resolvedIps.join(", ")} but should point to ${expectedIp}`
					: undefined,
			};
		}

		// If no expected IP, just return the resolved IP
		return {
			isValid: true,
			resolvedIp: resolvedIps.join(", "),
		};
	} catch (error) {
		return {
			isValid: false,
			error:
				error instanceof Error ? error.message : "Failed to resolve domain",
		};
	}
};
