// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// dns-cap.ts — the native @zap-proto/web DNS capability.
//
// Binary-ZAP replacement for the tRPC `dnsRouter` (server/api/routers/dns.ts):
//   - dnsMintCap:  bearer→ctx boundary at the WS upgrade (replaces
//                  `protectedProcedure`). A null return rejects the upgrade
//                  with HTTP 401, so unauthenticated sockets never open.
//   - dnsRootCap:  rootCap(ctx) → CallHandler. Dispatches each decoded ZAP Call
//                  by its method ordinal (DnsMethod, generated from dns.zap) to
//                  the same service functions the tRPC procedure called.
//
// Inputs ride the shared Args carrier (decodeArgs); results the shared Result
// carrier (encodeResult). The DnsMethod ordinal table is generated from
// dns.zap — this file holds only the auth gate and the service routing.

import dns from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import {
	addPagesCustomDomain,
	createPagesDeployment,
	createPagesProject,
	getCloudflareConfig,
	getPagesProject,
	listPagesProjects,
	removePagesCustomDomain,
} from "@hanzo/platform/services/cloudflare";
import {
	createDnsProvider,
	type DnsProviderType,
} from "@hanzo/platform/services/dns-provider";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { DnsMethod } from "./schema/dns_zap";

/** Per-connection auth context. DNS methods are all session-gated. */
export interface DnsCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
}

/**
 * dnsMintCap — bearer→ctx boundary. Replaces `protectedProcedure`: validates
 * the upgrade request (session cookie / x-api-key) and returns the typed ctx.
 * Null → the upgrade is rejected with HTTP 401 before any WebSocket opens.
 */
export const dnsMintCap: MintCap<DnsCtx> = async (req: IncomingMessage) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as DnsCtx["userRole"];
	return { organizationId, userRole, userId: (user as { id: string }).id };
};

/** Typed errors → ZAP status codes (mirror the tRPC error codes). */
class BadRequestError extends Error {}
class NotFoundError extends Error {}

// ============================================================================
// Shared Schemas / Helpers (ported verbatim from dns.ts)
// ============================================================================

/**
 * Resolve a DnsProvider instance from the optional provider input.
 *
 * DNS zone/record management goes through the per-org Hanzo DNS control plane
 * (dns.hanzo.ai/v1/dns) by DEFAULT — that plane owns the upstream provider per
 * org (authoritative CoreDNS, or Cloudflare via the org's KMS-sealed connector),
 * so the platform never reaches Cloudflare with a global env token for DNS. The
 * global-env Cloudflare client is used ONLY when a caller explicitly asks for
 * `provider: "cloudflare"` (and for the CF-Pages endpoints below, which are a
 * distinct Cloudflare-only product surface).
 */
async function resolveProvider(providerType?: DnsProviderType) {
	return createDnsProvider(providerType ?? "hanzo");
}

/**
 * Wrap a provider operation in standard error handling. `BadRequest` maps to
 * BadRequestError, everything else to the default (Internal).
 */
async function withProviderError<T>(
	operation: () => Promise<T>,
	fallbackMessage: string,
	code: "BadRequest" | "Internal" = "Internal",
): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		const message = error instanceof Error ? error.message : fallbackMessage;
		if (code === "BadRequest") throw new BadRequestError(message);
		throw new Error(message);
	}
}

/**
 * dnsRootCap — the connection's dispatch root. For each decoded Call, decode the
 * input via the shared Args carrier, run the matching service function (the very
 * same one the tRPC procedure ran), and encode the result. Errors map to ZAP
 * status codes, never a thrown HTTP 500 leak.
 */
export function dnsRootCap(_ctx: DnsCtx): CallHandler {
	return async (call: Call): Promise<Response> => {
		try {
			const value = await dispatch(call);
			return {
				status: Status.OK,
				promiseID: call.promiseID,
				body: encodeResult(value),
			};
		} catch (err) {
			const status =
				err instanceof NotFoundError
					? Status.NotFound
					: err instanceof BadRequestError
						? Status.BadRequest
						: Status.Internal;
			const message = err instanceof Error ? err.message : "internal error";
			return {
				status,
				promiseID: call.promiseID,
				body: encodeResult({ error: message }),
			};
		}
	};
}

async function dispatch(call: Call): Promise<unknown> {
	switch (call.method) {
		// -------------------------------------------------------------------
		// Provider-aware DNS zone endpoints
		// -------------------------------------------------------------------
		case DnsMethod.listZones: {
			const input = decodeArgs<{ provider?: DnsProviderType } | undefined>(
				call.payload,
			);
			return withProviderError(async () => {
				const provider = await resolveProvider(input?.provider);
				return provider.listZones();
			}, "Failed to list DNS zones");
		}
		case DnsMethod.createZone: {
			const input = decodeArgs<{ provider: DnsProviderType; name: string }>(
				call.payload,
			);
			return withProviderError(
				async () => {
					const provider = await resolveProvider(input.provider);
					return provider.createZone(input.name);
				},
				"Failed to create DNS zone",
				"BadRequest",
			);
		}
		case DnsMethod.deleteZone: {
			const input = decodeArgs<{ provider: DnsProviderType; zoneId: string }>(
				call.payload,
			);
			return withProviderError(
				async () => {
					const provider = await resolveProvider(input.provider);
					await provider.deleteZone(input.zoneId);
					return { success: true };
				},
				"Failed to delete DNS zone",
				"BadRequest",
			);
		}

		// -------------------------------------------------------------------
		// Provider-aware DNS record endpoints
		// -------------------------------------------------------------------
		case DnsMethod.listRecords: {
			const input = decodeArgs<{
				zoneId?: string;
				provider?: DnsProviderType;
			}>(call.payload);
			return withProviderError(async () => {
				const provider = await resolveProvider(input.provider);
				if (provider.type === "cloudflare" && !input.zoneId) {
					const config = getCloudflareConfig();
					return provider.listRecords(config.zoneId);
				}
				if (!input.zoneId) {
					throw new Error("zoneId is required for this provider");
				}
				return provider.listRecords(input.zoneId);
			}, "Failed to list DNS records");
		}
		case DnsMethod.createRecord: {
			const input = decodeArgs<{
				type: string;
				name: string;
				content: string;
				proxied?: boolean;
				ttl?: number;
				priority?: number;
				comment?: string;
				zoneId?: string;
				provider?: DnsProviderType;
			}>(call.payload);
			return withProviderError(
				async () => {
					const provider = await resolveProvider(input.provider);
					let zoneId = input.zoneId;
					if (!zoneId && provider.type === "cloudflare") {
						const config = getCloudflareConfig();
						zoneId = config.zoneId;
					}
					if (!zoneId) {
						throw new Error("zoneId is required for this provider");
					}
					return provider.createRecord(zoneId, {
						type: input.type,
						name: input.name,
						content: input.content,
						proxied: input.proxied,
						ttl: input.ttl,
						priority: input.priority,
						comment: input.comment,
					});
				},
				"Failed to create DNS record",
				"BadRequest",
			);
		}
		case DnsMethod.updateRecord: {
			const input = decodeArgs<{
				recordId: string;
				type?: string;
				name?: string;
				content?: string;
				proxied?: boolean;
				ttl?: number;
				priority?: number;
				comment?: string;
				zoneId?: string;
				provider?: DnsProviderType;
			}>(call.payload);
			return withProviderError(
				async () => {
					const provider = await resolveProvider(input.provider);
					let zoneId = input.zoneId;
					if (!zoneId && provider.type === "cloudflare") {
						const config = getCloudflareConfig();
						zoneId = config.zoneId;
					}
					if (!zoneId) {
						throw new Error("zoneId is required for this provider");
					}
					const { recordId, zoneId: _, provider: __, ...updateFields } = input;
					return provider.updateRecord(zoneId, recordId, updateFields);
				},
				"Failed to update DNS record",
				"BadRequest",
			);
		}
		case DnsMethod.deleteRecord: {
			const input = decodeArgs<{
				recordId: string;
				zoneId?: string;
				provider?: DnsProviderType;
			}>(call.payload);
			return withProviderError(
				async () => {
					const provider = await resolveProvider(input.provider);
					let zoneId = input.zoneId;
					if (!zoneId && provider.type === "cloudflare") {
						const config = getCloudflareConfig();
						zoneId = config.zoneId;
					}
					if (!zoneId) {
						throw new Error("zoneId is required for this provider");
					}
					await provider.deleteRecord(zoneId, input.recordId);
					return { success: true };
				},
				"Failed to delete DNS record",
				"BadRequest",
			);
		}

		// -------------------------------------------------------------------
		// DNS verification (provider-agnostic, uses system DNS resolver)
		// -------------------------------------------------------------------
		case DnsMethod.verifyDomain: {
			const input = decodeArgs<{ domain: string; expectedIp?: string }>(
				call.payload,
			);
			try {
				const addresses = await dns.resolve4(input.domain);

				if (addresses.length === 0) {
					return {
						resolved: false,
						addresses: [],
						matches: false,
						message: `No A records found for ${input.domain}`,
					};
				}

				const matches = input.expectedIp
					? addresses.includes(input.expectedIp)
					: true;

				return {
					resolved: true,
					addresses,
					matches,
					message: matches
						? `DNS resolves correctly for ${input.domain}`
						: `DNS resolves to ${addresses.join(", ")} but expected ${input.expectedIp}`,
				};
			} catch (error) {
				const isNodeError = error instanceof Error && "code" in error;
				const errorCode = isNodeError
					? (error as NodeJS.ErrnoException).code
					: undefined;

				if (errorCode === "ENOTFOUND" || errorCode === "ENODATA") {
					return {
						resolved: false,
						addresses: [],
						matches: false,
						message: `Domain ${input.domain} does not resolve (${errorCode})`,
					};
				}

				throw new Error(
					error instanceof Error
						? error.message
						: "Failed to verify domain DNS",
				);
			}
		}

		// -------------------------------------------------------------------
		// Cloudflare Pages endpoints (CF-only features, unchanged)
		// -------------------------------------------------------------------
		case DnsMethod.listPagesProjects: {
			try {
				const config = getCloudflareConfig();
				return await listPagesProjects(config.apiToken, config.accountId);
			} catch (error) {
				throw new Error(
					error instanceof Error
						? error.message
						: "Failed to list Pages projects",
				);
			}
		}
		case DnsMethod.getPagesProject: {
			const input = decodeArgs<{ projectName: string }>(call.payload);
			try {
				const config = getCloudflareConfig();
				return await getPagesProject(
					config.apiToken,
					config.accountId,
					input.projectName,
				);
			} catch (error) {
				throw new NotFoundError(
					error instanceof Error
						? error.message
						: `Pages project '${input.projectName}' not found`,
				);
			}
		}
		case DnsMethod.createPagesProject: {
			const input = decodeArgs<{
				name: string;
				production_branch?: string;
			}>(call.payload);
			try {
				const config = getCloudflareConfig();
				return await createPagesProject(config.apiToken, config.accountId, {
					name: input.name,
					production_branch: input.production_branch,
				});
			} catch (error) {
				throw new BadRequestError(
					error instanceof Error
						? error.message
						: "Failed to create Pages project",
				);
			}
		}
		case DnsMethod.triggerPagesDeploy: {
			const input = decodeArgs<{ projectName: string; branch?: string }>(
				call.payload,
			);
			try {
				const config = getCloudflareConfig();
				return await createPagesDeployment(
					config.apiToken,
					config.accountId,
					input.projectName,
					input.branch,
				);
			} catch (error) {
				throw new BadRequestError(
					error instanceof Error
						? error.message
						: "Failed to trigger Pages deployment",
				);
			}
		}
		case DnsMethod.addPagesDomain: {
			const input = decodeArgs<{ projectName: string; domain: string }>(
				call.payload,
			);
			try {
				const config = getCloudflareConfig();
				return await addPagesCustomDomain(
					config.apiToken,
					config.accountId,
					input.projectName,
					input.domain,
				);
			} catch (error) {
				throw new BadRequestError(
					error instanceof Error
						? error.message
						: "Failed to add custom domain to Pages project",
				);
			}
		}
		case DnsMethod.removePagesDomain: {
			const input = decodeArgs<{ projectName: string; domainId: string }>(
				call.payload,
			);
			try {
				const config = getCloudflareConfig();
				await removePagesCustomDomain(
					config.apiToken,
					config.accountId,
					input.projectName,
					input.domainId,
				);
				return { success: true };
			} catch (error) {
				throw new BadRequestError(
					error instanceof Error
						? error.message
						: "Failed to remove custom domain from Pages project",
				);
			}
		}
		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
