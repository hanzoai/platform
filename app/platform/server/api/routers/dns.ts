import dns from "node:dns/promises";
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
import { isHanzoDnsConfigured } from "@hanzo/platform/services/hanzo-dns-provider";
import { resolveCloudflareCredentials } from "@dokploy/server/services/deploy-provider";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";

// ============================================================================
// Shared Schemas
// ============================================================================

const dnsProviderTypeSchema = z.enum(["cloudflare", "hanzo"]);

const dnsRecordTypeSchema = z.enum([
	"A",
	"AAAA",
	"CNAME",
	"TXT",
	"MX",
	"NS",
	"SRV",
	"CAA",
	"PTR",
	"LOC",
	"SPF",
	"CERT",
	"DNSKEY",
	"DS",
	"NAPTR",
	"SMIMEA",
	"SSHFP",
	"TLSA",
	"URI",
]);

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve a DnsProvider instance from the optional provider input.
 * When no explicit provider is given, prefers Hanzo DNS (dns.hanzo.ai)
 * if HANZO_DNS_API_KEY is set, otherwise falls back to Cloudflare.
 */
async function resolveProvider(providerType?: DnsProviderType) {
	const effectiveType =
		providerType ?? (isHanzoDnsConfigured() ? "hanzo" : "cloudflare");
	return createDnsProvider(effectiveType);
}

/**
 * Wrap a provider operation in standard tRPC error handling.
 */
async function withProviderError<T>(
	operation: () => Promise<T>,
	fallbackMessage: string,
	code: TRPCError["code"] = "INTERNAL_SERVER_ERROR",
): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		throw new TRPCError({
			code,
			message: error instanceof Error ? error.message : fallbackMessage,
			cause: error,
		});
	}
}

// ============================================================================
// Router
// ============================================================================

export const dnsRouter = createTRPCRouter({
	// -----------------------------------------------------------------------
	// Provider-aware DNS zone endpoints
	// -----------------------------------------------------------------------

	listZones: protectedProcedure
		.input(
			z
				.object({
					provider: dnsProviderTypeSchema.optional(),
				})
				.optional(),
		)
		.query(async ({ input }) => {
			return withProviderError(async () => {
				const provider = await resolveProvider(input?.provider);
				return provider.listZones();
			}, "Failed to list DNS zones");
		}),

	createZone: protectedProcedure
		.input(
			z.object({
				provider: dnsProviderTypeSchema,
				name: z.string().min(1),
			}),
		)
		.mutation(async ({ input }) => {
			return withProviderError(
				async () => {
					const provider = await resolveProvider(input.provider);
					return provider.createZone(input.name);
				},
				"Failed to create DNS zone",
				"BAD_REQUEST",
			);
		}),

	deleteZone: protectedProcedure
		.input(
			z.object({
				provider: dnsProviderTypeSchema,
				zoneId: z.string().min(1),
			}),
		)
		.mutation(async ({ input }) => {
			return withProviderError(
				async () => {
					const provider = await resolveProvider(input.provider);
					await provider.deleteZone(input.zoneId);
					return { success: true };
				},
				"Failed to delete DNS zone",
				"BAD_REQUEST",
			);
		}),

	// -----------------------------------------------------------------------
	// Provider-aware DNS record endpoints
	// -----------------------------------------------------------------------

	listRecords: protectedProcedure
		.input(
			z.object({
				zoneId: z.string().optional(),
				provider: dnsProviderTypeSchema.optional(),
			}),
		)
		.query(async ({ input }) => {
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
		}),

	createRecord: protectedProcedure
		.input(
			z.object({
				type: dnsRecordTypeSchema,
				name: z.string().min(1),
				content: z.string().min(1),
				proxied: z.boolean().optional(),
				ttl: z.number().int().positive().optional(),
				priority: z.number().int().optional(),
				comment: z.string().optional(),
				zoneId: z.string().optional(),
				provider: dnsProviderTypeSchema.optional(),
			}),
		)
		.mutation(async ({ input }) => {
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
				"BAD_REQUEST",
			);
		}),

	updateRecord: protectedProcedure
		.input(
			z.object({
				recordId: z.string().min(1),
				type: dnsRecordTypeSchema.optional(),
				name: z.string().min(1).optional(),
				content: z.string().min(1).optional(),
				proxied: z.boolean().optional(),
				ttl: z.number().int().positive().optional(),
				priority: z.number().int().optional(),
				comment: z.string().optional(),
				zoneId: z.string().optional(),
				provider: dnsProviderTypeSchema.optional(),
			}),
		)
		.mutation(async ({ input }) => {
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
				"BAD_REQUEST",
			);
		}),

	deleteRecord: protectedProcedure
		.input(
			z.object({
				recordId: z.string().min(1),
				zoneId: z.string().optional(),
				provider: dnsProviderTypeSchema.optional(),
			}),
		)
		.mutation(async ({ input }) => {
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
				"BAD_REQUEST",
			);
		}),

	// -----------------------------------------------------------------------
	// DNS verification (provider-agnostic, uses system DNS resolver)
	// -----------------------------------------------------------------------

	verifyDomain: protectedProcedure
		.input(
			z.object({
				domain: z.string().min(1),
				expectedIp: z.string().optional(),
			}),
		)
		.mutation(async ({ input }) => {
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

				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message:
						error instanceof Error
							? error.message
							: "Failed to verify domain DNS",
					cause: error,
				});
			}
		}),

	// -----------------------------------------------------------------------
	// Cloudflare Pages endpoints (CF-only features, unchanged)
	// -----------------------------------------------------------------------

	listPagesProjects: protectedProcedure.query(async () => {
		try {
			const config = getCloudflareConfig();
			return await listPagesProjects(config.apiToken, config.accountId);
		} catch (error) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message:
					error instanceof Error
						? error.message
						: "Failed to list Pages projects",
				cause: error,
			});
		}
	}),

	getPagesProject: protectedProcedure
		.input(
			z.object({
				projectName: z.string().min(1),
			}),
		)
		.query(async ({ input }) => {
			try {
				const config = getCloudflareConfig();
				return await getPagesProject(
					config.apiToken,
					config.accountId,
					input.projectName,
				);
			} catch (error) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message:
						error instanceof Error
							? error.message
							: `Pages project '${input.projectName}' not found`,
					cause: error,
				});
			}
		}),

	createPagesProject: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				production_branch: z.string().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			try {
				const config = getCloudflareConfig();
				return await createPagesProject(config.apiToken, config.accountId, {
					name: input.name,
					production_branch: input.production_branch,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Failed to create Pages project",
					cause: error,
				});
			}
		}),

	triggerPagesDeploy: protectedProcedure
		.input(
			z.object({
				projectName: z.string().min(1),
				branch: z.string().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			try {
				const config = getCloudflareConfig();
				return await createPagesDeployment(
					config.apiToken,
					config.accountId,
					input.projectName,
					input.branch,
				);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Failed to trigger Pages deployment",
					cause: error,
				});
			}
		}),

	addPagesDomain: protectedProcedure
		.input(
			z.object({
				projectName: z.string().min(1),
				domain: z.string().min(1),
			}),
		)
		.mutation(async ({ input }) => {
			try {
				const config = getCloudflareConfig();
				return await addPagesCustomDomain(
					config.apiToken,
					config.accountId,
					input.projectName,
					input.domain,
				);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Failed to add custom domain to Pages project",
					cause: error,
				});
			}
		}),

	removePagesDomain: protectedProcedure
		.input(
			z.object({
				projectName: z.string().min(1),
				domainId: z.string().min(1),
			}),
		)
		.mutation(async ({ input }) => {
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
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Failed to remove custom domain from Pages project",
					cause: error,
				});
			}
		}),
});
