/**
 * DigitalOcean tRPC Router
 *
 * Provides API endpoints for managing DigitalOcean cloud resources:
 * - Provider configuration and credentials
 * - Droplet lifecycle management
 * - Scaling operations (scale up/down)
 * - Firewall and load balancer management
 * - Real-time status monitoring
 */

import { TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { db } from "@/server/db";
import {
	apiConfigureCloudProvider,
	apiDrainNode,
	apiRegisterNode,
	apiRemoveDroplet,
	apiResizeDroplet,
	apiScaleDown,
	apiScaleUp,
	apiUpdateCloudProvider,
	cloudProvider,
	provisionedDroplet,
	scalingJob,
} from "@/server/db/schema";
import {
	configureDigitalOceanProvider,
	createDroplet,
	createPoolFirewall,
	createPoolLoadBalancer,
	deleteDroplet,
	drainNode,
	getScalingJobStatus,
	listDropletSizes,
	listPoolDroplets,
	listRegions,
	registerNode,
	resizeDroplet,
	scaleDownPool,
	scaleUpPool,
} from "@hanzo/platform/services/digitalocean";

// ============================================================================
// Helper: Verify organization ownership
// ============================================================================

async function verifyProviderOwnership(
	providerId: string,
	organizationId: string
): Promise<void> {
	const provider = await db.query.cloudProvider.findFirst({
		where: eq(cloudProvider.providerId, providerId),
	});

	if (!provider) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Cloud provider not found",
		});
	}

	if (provider.organizationId !== organizationId) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "You are not authorized to access this provider",
		});
	}
}

async function verifyPoolOwnership(
	poolId: string,
	organizationId: string
): Promise<void> {
	const { computePool } = await import("@/server/db/schema");
	const pool = await db.query.computePool.findFirst({
		where: eq(computePool.poolId, poolId),
	});

	if (!pool) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Compute pool not found",
		});
	}

	if (pool.organizationId !== organizationId) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "You are not authorized to access this pool",
		});
	}
}

// ============================================================================
// Router
// ============================================================================

export const digitaloceanRouter = createTRPCRouter({
	// ========================================================================
	// Provider Configuration
	// ========================================================================

	/**
	 * Configure a new DigitalOcean provider
	 */
	configureProvider: protectedProcedure
		.input(apiConfigureCloudProvider)
		.mutation(async ({ ctx, input }) => {
			try {
				const provider = await configureDigitalOceanProvider(
					ctx.session.activeOrganizationId,
					{
						name: input.name,
						slug: input.slug,
						apiToken: input.apiToken,
						region: input.defaultRegion,
					}
				);
				return provider;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: error instanceof Error ? error.message : "Failed to configure provider",
				});
			}
		}),

	/**
	 * Update provider configuration
	 */
	updateProvider: protectedProcedure
		.input(apiUpdateCloudProvider)
		.mutation(async ({ ctx, input }) => {
			await verifyProviderOwnership(input.providerId, ctx.session.activeOrganizationId);

			const updateData: Record<string, unknown> = {
				updatedAt: new Date(),
			};

			if (input.name) updateData.name = input.name;
			if (input.defaultRegion) updateData.defaultRegion = input.defaultRegion;
			if (input.defaultSize) updateData.defaultSize = input.defaultSize;
			if (input.defaultImage) updateData.defaultImage = input.defaultImage;
			if (typeof input.isActive === "boolean") updateData.isActive = input.isActive;

			// Update API token if provided (should be re-validated and encrypted)
			if (input.apiToken) {
				// In production, validate and encrypt the new token
				updateData.credentials = { apiToken: input.apiToken };
				updateData.lastValidated = new Date();
			}

			const [provider] = await db
				.update(cloudProvider)
				.set(updateData)
				.where(eq(cloudProvider.providerId, input.providerId))
				.returning();

			return provider;
		}),

	/**
	 * List configured providers for organization
	 */
	listProviders: protectedProcedure.query(async ({ ctx }) => {
		const providers = await db.query.cloudProvider.findMany({
			where: eq(cloudProvider.organizationId, ctx.session.activeOrganizationId),
		});

		// Remove sensitive credentials from response
		return providers.map((p) => ({
			...p,
			credentials: { region: p.credentials?.region }, // Only expose non-sensitive data
		}));
	}),

	/**
	 * Get provider details
	 */
	getProvider: protectedProcedure
		.input(z.object({ providerId: z.string() }))
		.query(async ({ ctx, input }) => {
			await verifyProviderOwnership(input.providerId, ctx.session.activeOrganizationId);

			const provider = await db.query.cloudProvider.findFirst({
				where: eq(cloudProvider.providerId, input.providerId),
			});

			if (!provider) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
			}

			return {
				...provider,
				credentials: { region: provider.credentials?.region },
			};
		}),

	/**
	 * Delete a provider
	 */
	deleteProvider: protectedProcedure
		.input(z.object({ providerId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await verifyProviderOwnership(input.providerId, ctx.session.activeOrganizationId);

			// Check for active droplets
			const activeDroplets = await db.query.provisionedDroplet.findMany({
				where: and(
					eq(provisionedDroplet.cloudProviderId, input.providerId),
					eq(provisionedDroplet.status, "running")
				),
			});

			if (activeDroplets.length > 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Cannot delete provider with ${activeDroplets.length} active droplets`,
				});
			}

			await db
				.delete(cloudProvider)
				.where(eq(cloudProvider.providerId, input.providerId));

			return { success: true };
		}),

	// ========================================================================
	// Resource Discovery
	// ========================================================================

	/**
	 * List available droplet sizes
	 */
	listSizes: protectedProcedure
		.input(
			z.object({
				providerId: z.string(),
				region: z.string().optional(),
			})
		)
		.query(async ({ ctx, input }) => {
			await verifyProviderOwnership(input.providerId, ctx.session.activeOrganizationId);
			return listDropletSizes(input.providerId, input.region);
		}),

	/**
	 * List available regions
	 */
	listRegions: protectedProcedure
		.input(z.object({ providerId: z.string() }))
		.query(async ({ ctx, input }) => {
			await verifyProviderOwnership(input.providerId, ctx.session.activeOrganizationId);
			return listRegions(input.providerId);
		}),

	// ========================================================================
	// Scaling Operations
	// ========================================================================

	/**
	 * Scale up - add new nodes to pool
	 */
	scaleUp: protectedProcedure
		.input(apiScaleUp)
		.mutation(async ({ ctx, input }) => {
			await verifyProviderOwnership(input.providerId, ctx.session.activeOrganizationId);
			await verifyPoolOwnership(input.poolId, ctx.session.activeOrganizationId);

			// Zod defaults are applied, assert required fields
			return scaleUpPool(ctx.session.activeOrganizationId, {
				poolId: input.poolId,
				providerId: input.providerId,
				count: input.count,
				size: input.size ?? "s-2vcpu-4gb",
				region: input.region ?? "nyc1",
				nodeType: input.nodeType ?? "worker",
				labels: input.labels,
			});
		}),

	/**
	 * Scale down - remove nodes from pool
	 */
	scaleDown: protectedProcedure
		.input(apiScaleDown)
		.mutation(async ({ ctx, input }) => {
			await verifyPoolOwnership(input.poolId, ctx.session.activeOrganizationId);

			// Zod defaults are applied, assert required fields
			return scaleDownPool(ctx.session.activeOrganizationId, {
				poolId: input.poolId,
				count: input.count,
				strategy: input.strategy ?? "oldest",
				nodeIds: input.nodeIds,
			});
		}),

	/**
	 * Resize a specific droplet
	 */
	resizeDroplet: protectedProcedure
		.input(apiResizeDroplet)
		.mutation(async ({ ctx, input }) => {
			// Verify ownership through droplet -> provider -> organization chain
			const droplet = await db.query.provisionedDroplet.findFirst({
				where: eq(provisionedDroplet.dropletId, input.dropletId),
				with: { cloudProvider: true },
			});

			if (!droplet) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Droplet not found" });
			}

			if (droplet.cloudProvider.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}

			// Assert required fields after validation
			await resizeDroplet({
				dropletId: input.dropletId,
				newSize: input.newSize,
				resizeDisk: input.resizeDisk ?? false,
			});
			return { success: true };
		}),

	/**
	 * Drain node before removal (migrate workloads)
	 */
	drainNode: protectedProcedure
		.input(apiDrainNode)
		.mutation(async ({ ctx, input }) => {
			// Verify ownership
			const { computeNode } = await import("@/server/db/schema");
			const node = await db.query.computeNode.findFirst({
				where: eq(computeNode.nodeId, input.nodeId),
				with: { pool: true },
			});

			if (!node?.pool) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Node not found" });
			}

			if (node.pool.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}

			await drainNode(input.nodeId, input.force);
			return { success: true };
		}),

	/**
	 * Remove a specific droplet
	 */
	removeDroplet: protectedProcedure
		.input(apiRemoveDroplet)
		.mutation(async ({ ctx, input }) => {
			const droplet = await db.query.provisionedDroplet.findFirst({
				where: eq(provisionedDroplet.dropletId, input.dropletId),
				with: { cloudProvider: true },
			});

			if (!droplet) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Droplet not found" });
			}

			if (droplet.cloudProvider.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({ code: "UNAUTHORIZED" });
			}

			await deleteDroplet(input.dropletId, input.force);
			return { success: true };
		}),

	// ========================================================================
	// Status & Monitoring
	// ========================================================================

	/**
	 * List all droplets in a pool
	 */
	listPoolDroplets: protectedProcedure
		.input(z.object({ poolId: z.string() }))
		.query(async ({ ctx, input }) => {
			await verifyPoolOwnership(input.poolId, ctx.session.activeOrganizationId);
			return listPoolDroplets(input.poolId);
		}),

	/**
	 * Get scaling job status
	 */
	getScalingStatus: protectedProcedure
		.input(z.object({ jobId: z.string() }))
		.query(async ({ ctx, input }) => {
			const job = await getScalingJobStatus(input.jobId);

			if (!job) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Scaling job not found" });
			}

			// Verify ownership
			await verifyPoolOwnership(job.poolId, ctx.session.activeOrganizationId);

			return job;
		}),

	/**
	 * List active scaling jobs for a pool
	 */
	listScalingJobs: protectedProcedure
		.input(z.object({ poolId: z.string() }))
		.query(async ({ ctx, input }) => {
			await verifyPoolOwnership(input.poolId, ctx.session.activeOrganizationId);

			return db.query.scalingJob.findMany({
				where: eq(scalingJob.poolId, input.poolId),
				orderBy: (scalingJob, { desc }) => [desc(scalingJob.createdAt)],
				limit: 20,
			});
		}),

	/**
	 * WebSocket subscription for real-time node status updates
	 */
	onNodeStatusChange: protectedProcedure
		.input(z.object({ poolId: z.string() }))
		.subscription(async function* ({ ctx, input }) {
			await verifyPoolOwnership(input.poolId, ctx.session.activeOrganizationId);

			// Poll for changes every 5 seconds
			// In production, this would use Redis pub/sub or similar
			while (true) {
				const droplets = await listPoolDroplets(input.poolId);
				yield {
					type: "status_update",
					poolId: input.poolId,
					droplets: droplets.map((d) => {
						// Type assertion for Drizzle's `with` clause result
						const dropletWithRelation = d as typeof d & {
							computeNode?: {
								status: string;
								cpuUtilizationPercent: string | null;
								memoryUtilizationPercent: string | null;
							} | null;
						};
						return {
							dropletId: d.dropletId,
							status: d.status,
							publicIp: d.publicIp,
							computeNode: dropletWithRelation.computeNode
								? {
										status: dropletWithRelation.computeNode.status,
										cpuUtilization: dropletWithRelation.computeNode.cpuUtilizationPercent,
										memoryUtilization: dropletWithRelation.computeNode.memoryUtilizationPercent,
								  }
								: null,
						};
					}),
					timestamp: new Date().toISOString(),
				};

				await new Promise((resolve) => setTimeout(resolve, 5000));
			}
		}),

	// ========================================================================
	// Infrastructure Management
	// ========================================================================

	/**
	 * Create firewall for a pool
	 */
	createFirewall: protectedProcedure
		.input(
			z.object({
				providerId: z.string(),
				poolId: z.string(),
			})
		)
		.mutation(async ({ ctx, input }) => {
			await verifyProviderOwnership(input.providerId, ctx.session.activeOrganizationId);
			await verifyPoolOwnership(input.poolId, ctx.session.activeOrganizationId);

			const firewallId = await createPoolFirewall(input.providerId, input.poolId);
			return { firewallId };
		}),

	/**
	 * Create load balancer for a pool
	 */
	createLoadBalancer: protectedProcedure
		.input(
			z.object({
				providerId: z.string(),
				poolId: z.string(),
				region: z.string(),
				algorithm: z.enum(["round_robin", "least_connections"]).optional(),
				healthCheck: z
					.object({
						protocol: z.enum(["http", "https", "tcp"]),
						port: z.number().int().min(1).max(65535),
						path: z.string().optional(),
					})
					.optional(),
			})
		)
		.mutation(async ({ ctx, input }) => {
			await verifyProviderOwnership(input.providerId, ctx.session.activeOrganizationId);
			await verifyPoolOwnership(input.poolId, ctx.session.activeOrganizationId);

			const lbId = await createPoolLoadBalancer(input.providerId, input.poolId, {
				region: input.region,
				algorithm: input.algorithm,
				healthCheck: input.healthCheck
					? {
							protocol: input.healthCheck.protocol,
							port: input.healthCheck.port,
							path: input.healthCheck.path,
					  }
					: undefined,
			});
			return { loadBalancerId: lbId };
		}),

	// ========================================================================
	// Node Registration (Internal/Bootstrap)
	// ========================================================================

	/**
	 * Register a node after bootstrap
	 * This endpoint is called by nodes during cloud-init
	 */
	registerNode: protectedProcedure
		.input(apiRegisterNode)
		.mutation(async ({ input }) => {
			// Note: This doesn't use ctx.session because it's called by the node
			// with a registration token, not a user session
			await registerNode(input.nodeId, input.registrationToken, {
				publicIp: input.publicIp,
				privateIp: input.privateIp,
				hostname: input.hostname,
				dockerNodeId: input.dockerNodeId,
			});

			return { success: true };
		}),

	/**
	 * Get swarm join token for a pool
	 * Called by nodes during bootstrap
	 */
	getSwarmJoinToken: protectedProcedure
		.input(
			z.object({
				poolId: z.string(),
				registrationToken: z.string(),
			})
		)
		.query(async ({ input }) => {
			// Verify registration token
			const droplet = await db.query.provisionedDroplet.findFirst({
				where: and(
					eq(provisionedDroplet.poolId, input.poolId),
					eq(provisionedDroplet.registrationToken, input.registrationToken)
				),
			});

			if (!droplet) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "Invalid registration token",
				});
			}

			// In production, fetch the actual swarm join token from the pool manager
			// For now, return a placeholder
			return {
				token: droplet.swarmJoinToken || "SWMTKN-placeholder",
			};
		}),
});
