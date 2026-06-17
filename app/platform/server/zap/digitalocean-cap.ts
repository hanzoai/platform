// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// digitalocean-cap.ts — the native @zap-proto/web DigitalOcean capability.
//
// Binary-ZAP replacement for the tRPC `digitaloceanRouter`
// (server/api/routers/digitalocean.ts). Every method was `protectedProcedure`
// whose body additionally enforces per-provider / per-pool / per-instance org
// ownership. The mint boundary requires session+user (a null return rejects the
// WS upgrade with HTTP 401, mirroring protectedProcedure); the ownership checks
// run INSIDE dispatch, verbatim from the original procedure bodies (the
// verifyProviderOwnership / verifyPoolOwnership helpers ported as-is). Inputs
// ride the shared Args carrier, results the shared Result carrier;
// DigitalOceanMethod ordinals are generated from digitalocean.zap.
//
// The tRPC `onNodeStatusChange` subscription had no client consumer and no ZAP
// transport equivalent (makeRpc carries only query/mutation), so it is dropped.

import type { IncomingMessage } from "node:http";
import { db } from "@hanzo/platform/db";
import { validateRequest } from "@hanzo/platform/lib/auth";
import {
	configureDigitalOceanProvider,
	createPoolFirewall,
	createPoolLoadBalancer,
	deleteInstance,
	drainNode,
	getScalingJobStatus,
	listInstanceSizes,
	listPoolInstances,
	listRegions,
	registerNode,
	resizeInstance,
	scaleDownPool,
	scaleUpPool,
} from "@hanzo/platform/services/digitalocean";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { and, eq } from "drizzle-orm";
import {
	cloudProvider,
	provisionedInstance,
	scalingJob,
} from "@/server/db/schema";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { DigitalOceanMethod } from "./schema/digitalocean_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface DigitalOceanCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
}

/**
 * digitaloceanMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`:
 * validates the upgrade and requires session+user. Null → HTTP 401 before any
 * socket opens. The per-provider / per-pool / per-instance org-ownership checks
 * run inside dispatch (verbatim from the bodies).
 */
export const digitaloceanMintCap: MintCap<DigitalOceanCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as DigitalOceanCtx["userRole"];
	const userId = (user as { id?: string }).id || "";
	return { organizationId, userRole, userId };
};

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}

// ============================================================================
// Helper: Verify organization ownership (ported verbatim from digitalocean.ts)
// ============================================================================

async function verifyProviderOwnership(
	providerId: string,
	organizationId: string,
): Promise<void> {
	const provider = await db.query.cloudProvider.findFirst({
		where: eq(cloudProvider.providerId, providerId),
	});

	if (!provider) {
		throw new NotFoundError("Cloud provider not found");
	}

	if (provider.organizationId !== organizationId) {
		throw new UnauthorizedError(
			"You are not authorized to access this provider",
		);
	}
}

async function verifyPoolOwnership(
	poolId: string,
	organizationId: string,
): Promise<void> {
	const { computePool } = await import("@/server/db/schema");
	const pool = await db.query.computePool.findFirst({
		where: eq(computePool.poolId, poolId),
	});

	if (!pool) {
		throw new NotFoundError("Compute pool not found");
	}

	if (pool.organizationId !== organizationId) {
		throw new UnauthorizedError("You are not authorized to access this pool");
	}
}

/**
 * digitaloceanRootCap — dispatch each decoded Call by DigitalOceanMethod ordinal
 * to the same service functions the tRPC procedure called. Inputs decode via the
 * shared Args carrier; results encode via the shared Result carrier. Errors map
 * to ZAP status codes (mirroring the tRPC error codes), never a thrown HTTP 500
 * leak.
 */
export function digitaloceanRootCap(ctx: DigitalOceanCtx): CallHandler {
	return async (call: Call): Promise<Response> => {
		try {
			const value = await dispatch(ctx, call);
			return {
				status: Status.OK,
				promiseID: call.promiseID,
				body: encodeResult(value),
			};
		} catch (err) {
			const status =
				err instanceof UnauthorizedError
					? Status.Unauthorized
					: err instanceof NotFoundError
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

async function dispatch(ctx: DigitalOceanCtx, call: Call): Promise<unknown> {
	const orgId = ctx.organizationId;
	switch (call.method) {
		case DigitalOceanMethod.configureProvider: {
			const input = decodeArgs<{
				name: string;
				slug: string;
				apiToken: string;
				defaultRegion?: string;
			}>(call.payload);
			try {
				const provider = await configureDigitalOceanProvider(orgId, {
					name: input.name,
					slug: input.slug,
					apiToken: input.apiToken,
					region: input.defaultRegion,
				});
				return provider;
			} catch (error) {
				throw new BadRequestError(
					error instanceof Error
						? error.message
						: "Failed to configure provider",
				);
			}
		}

		case DigitalOceanMethod.updateProvider: {
			const input = decodeArgs<{
				providerId: string;
				name?: string;
				defaultRegion?: string;
				defaultSize?: string;
				defaultImage?: string;
				isActive?: boolean;
				apiToken?: string;
			}>(call.payload);
			await verifyProviderOwnership(input.providerId, orgId);

			const updateData: Record<string, unknown> = {
				updatedAt: new Date(),
			};

			if (input.name) updateData.name = input.name;
			if (input.defaultRegion) updateData.defaultRegion = input.defaultRegion;
			if (input.defaultSize) updateData.defaultSize = input.defaultSize;
			if (input.defaultImage) updateData.defaultImage = input.defaultImage;
			if (typeof input.isActive === "boolean")
				updateData.isActive = input.isActive;

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
		}

		case DigitalOceanMethod.listProviders: {
			const providers = await db.query.cloudProvider.findMany({
				where: eq(cloudProvider.organizationId, orgId),
			});

			// Remove sensitive credentials from response
			return providers.map((p) => ({
				...p,
				credentials: { region: p.credentials?.region }, // Only expose non-sensitive data
			}));
		}

		case DigitalOceanMethod.getProvider: {
			const input = decodeArgs<{ providerId: string }>(call.payload);
			await verifyProviderOwnership(input.providerId, orgId);

			const provider = await db.query.cloudProvider.findFirst({
				where: eq(cloudProvider.providerId, input.providerId),
			});

			if (!provider) {
				throw new NotFoundError("Provider not found");
			}

			return {
				...provider,
				credentials: { region: provider.credentials?.region },
			};
		}

		case DigitalOceanMethod.deleteProvider: {
			const input = decodeArgs<{ providerId: string }>(call.payload);
			await verifyProviderOwnership(input.providerId, orgId);

			// Check for active instances
			const activeInstances = await db.query.provisionedInstance.findMany({
				where: and(
					eq(provisionedInstance.cloudProviderId, input.providerId),
					eq(provisionedInstance.status, "running"),
				),
			});

			if (activeInstances.length > 0) {
				throw new BadRequestError(
					`Cannot delete provider with ${activeInstances.length} active instances`,
				);
			}

			await db
				.delete(cloudProvider)
				.where(eq(cloudProvider.providerId, input.providerId));

			return { success: true };
		}

		case DigitalOceanMethod.listSizes: {
			const input = decodeArgs<{ providerId: string; region?: string }>(
				call.payload,
			);
			await verifyProviderOwnership(input.providerId, orgId);
			return listInstanceSizes(input.providerId, input.region);
		}

		case DigitalOceanMethod.listRegions: {
			const input = decodeArgs<{ providerId: string }>(call.payload);
			await verifyProviderOwnership(input.providerId, orgId);
			return listRegions(input.providerId);
		}

		case DigitalOceanMethod.scaleUp: {
			const input = decodeArgs<{
				providerId: string;
				poolId: string;
				count: number;
				size?: string;
				region?: string;
				nodeType?: string;
				labels?: unknown;
			}>(call.payload);
			await verifyProviderOwnership(input.providerId, orgId);
			await verifyPoolOwnership(input.poolId, orgId);

			// Zod defaults are applied, assert required fields
			return scaleUpPool(orgId, {
				poolId: input.poolId,
				providerId: input.providerId,
				count: input.count,
				size: input.size ?? "s-2vcpu-4gb",
				region: input.region ?? "nyc1",
				nodeType: input.nodeType ?? "worker",
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim from apiScaleUp input
				labels: input.labels as any,
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim from apiScaleUp input
			} as any);
		}

		case DigitalOceanMethod.scaleDown: {
			const input = decodeArgs<{
				poolId: string;
				count: number;
				strategy?: string;
				nodeIds?: string[];
			}>(call.payload);
			await verifyPoolOwnership(input.poolId, orgId);

			// Zod defaults are applied, assert required fields
			return scaleDownPool(orgId, {
				poolId: input.poolId,
				count: input.count,
				strategy: input.strategy ?? "oldest",
				nodeIds: input.nodeIds,
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim from apiScaleDown input
			} as any);
		}

		case DigitalOceanMethod.resizeInstance: {
			const input = decodeArgs<{
				instanceId: string;
				newSize: string;
				resizeDisk?: boolean;
			}>(call.payload);
			// Verify ownership through instance -> provider -> organization chain
			const instance = await db.query.provisionedInstance.findFirst({
				where: eq(provisionedInstance.instanceId, input.instanceId),
				with: { cloudProvider: true },
			});

			if (!instance) {
				throw new NotFoundError("Instance not found");
			}

			if (instance.cloudProvider.organizationId !== orgId) {
				throw new UnauthorizedError("");
			}

			// Assert required fields after validation
			await resizeInstance({
				instanceId: input.instanceId,
				newSize: input.newSize,
				resizeDisk: input.resizeDisk ?? false,
			});
			return { success: true };
		}

		case DigitalOceanMethod.drainNode: {
			const input = decodeArgs<{ nodeId: string; force?: boolean }>(
				call.payload,
			);
			// Verify ownership
			const { computeNode } = await import("@/server/db/schema");
			const node = await db.query.computeNode.findFirst({
				where: eq(computeNode.nodeId, input.nodeId),
				with: { pool: true },
			});

			if (!node?.pool) {
				throw new NotFoundError("Node not found");
			}

			if (node.pool.organizationId !== orgId) {
				throw new UnauthorizedError("");
			}

			await drainNode(input.nodeId, input.force);
			return { success: true };
		}

		case DigitalOceanMethod.removeInstance: {
			const input = decodeArgs<{ instanceId: string; force?: boolean }>(
				call.payload,
			);
			const instance = await db.query.provisionedInstance.findFirst({
				where: eq(provisionedInstance.instanceId, input.instanceId),
				with: { cloudProvider: true },
			});

			if (!instance) {
				throw new NotFoundError("Instance not found");
			}

			if (instance.cloudProvider.organizationId !== orgId) {
				throw new UnauthorizedError("");
			}

			await deleteInstance(input.instanceId, input.force);
			return { success: true };
		}

		case DigitalOceanMethod.listPoolInstances: {
			const input = decodeArgs<{ poolId: string }>(call.payload);
			await verifyPoolOwnership(input.poolId, orgId);
			return listPoolInstances(input.poolId);
		}

		case DigitalOceanMethod.getScalingStatus: {
			const input = decodeArgs<{ jobId: string }>(call.payload);
			const job = await getScalingJobStatus(input.jobId);

			if (!job) {
				throw new NotFoundError("Scaling job not found");
			}

			// Verify ownership
			await verifyPoolOwnership(job.poolId, orgId);

			return job;
		}

		case DigitalOceanMethod.listScalingJobs: {
			const input = decodeArgs<{ poolId: string }>(call.payload);
			await verifyPoolOwnership(input.poolId, orgId);

			return db.query.scalingJob.findMany({
				where: eq(scalingJob.poolId, input.poolId),
				orderBy: (scalingJob, { desc }) => [desc(scalingJob.createdAt)],
				limit: 20,
			});
		}

		case DigitalOceanMethod.createFirewall: {
			const input = decodeArgs<{ providerId: string; poolId: string }>(
				call.payload,
			);
			await verifyProviderOwnership(input.providerId, orgId);
			await verifyPoolOwnership(input.poolId, orgId);

			const firewallId = await createPoolFirewall(
				input.providerId,
				input.poolId,
			);
			return { firewallId };
		}

		case DigitalOceanMethod.createLoadBalancer: {
			const input = decodeArgs<{
				providerId: string;
				poolId: string;
				region: string;
				algorithm?: "round_robin" | "least_connections";
				healthCheck?: {
					protocol: "http" | "https" | "tcp";
					port: number;
					path?: string;
				};
			}>(call.payload);
			await verifyProviderOwnership(input.providerId, orgId);
			await verifyPoolOwnership(input.poolId, orgId);

			const lbId = await createPoolLoadBalancer(
				input.providerId,
				input.poolId,
				{
					region: input.region,
					algorithm: input.algorithm,
					healthCheck: input.healthCheck
						? {
								protocol: input.healthCheck.protocol,
								port: input.healthCheck.port,
								path: input.healthCheck.path,
							}
						: undefined,
				},
			);
			return { loadBalancerId: lbId };
		}

		case DigitalOceanMethod.registerNode: {
			const input = decodeArgs<{
				nodeId: string;
				registrationToken: string;
				publicIp?: string;
				privateIp?: string;
				hostname?: string;
				dockerNodeId?: string;
			}>(call.payload);
			// Note: This doesn't use ctx.session because it's called by the node
			// with a registration token, not a user session
			await registerNode(input.nodeId, input.registrationToken, {
				publicIp: input.publicIp ?? "",
				privateIp: input.privateIp,
				hostname: input.hostname,
				dockerNodeId: input.dockerNodeId,
			});

			return { success: true };
		}

		case DigitalOceanMethod.getSwarmJoinToken: {
			const input = decodeArgs<{ poolId: string; registrationToken: string }>(
				call.payload,
			);
			// Verify registration token
			const instance = await db.query.provisionedInstance.findFirst({
				where: and(
					eq(provisionedInstance.poolId, input.poolId),
					eq(provisionedInstance.registrationToken, input.registrationToken),
				),
			});

			if (!instance) {
				throw new UnauthorizedError("Invalid registration token");
			}

			// In production, fetch the actual swarm join token from the pool manager
			// For now, return a placeholder
			return {
				token: instance.swarmJoinToken || "SWMTKN-placeholder",
			};
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
