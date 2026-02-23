/**
 * DOKS (DigitalOcean Kubernetes Service) tRPC Router
 *
 * Manages DOKS cluster lifecycle, node pools, fleet operations, and billing.
 * Calls service functions from @hanzo/platform/services/doks-provisioner and billing.
 */

import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc";
import {
	apiProvisionDoksCluster,
	apiFindOneDoksCluster,
	apiDeleteDoksCluster,
	apiAddNodePool,
	apiUpdateNodePool,
	apiDeleteNodePool,
	doksCluster,
} from "@hanzo/platform/db/schema";
import {
	provisionDoksCluster,
	findDoksClusterById,
	findDoksClusterByOrgId,
	getDoksClusterStatus,
	getDoksKubeconfig,
	deleteDoksCluster,
	addNodePool,
	updateNodePool,
	deleteNodePool,
	upgradeToHA,
	listDoksClusters,
	syncDoksFleet,
	listNodeSizes,
	listRegions,
} from "@hanzo/platform/services/doks-provisioner";
import {
	calculateClusterCost,
	getOrgBilling,
	getFleetBilling,
	recordBillingSnapshot,
} from "@hanzo/platform/services/billing";
import { db } from "@hanzo/platform/db";

// --- Helpers ---

async function verifyClusterOwnership(
	doksClusterId: string,
	organizationId: string,
) {
	const cluster = await db.query.doksCluster.findFirst({
		where: eq(doksCluster.doksClusterId, doksClusterId),
	});

	if (!cluster) {
		throw new TRPCError({ code: "NOT_FOUND", message: "DOKS cluster not found" });
	}

	if (cluster.organizationId !== organizationId) {
		throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authorized for this cluster" });
	}

	return cluster;
}

// --- Router ---

export const doksRouter = createTRPCRouter({
	// ========================================================================
	// Cluster Lifecycle
	// ========================================================================

	provision: protectedProcedure
		.input(apiProvisionDoksCluster)
		.mutation(async ({ ctx, input }) => {
			return provisionDoksCluster({
				...input,
				organizationId: input.organizationId || ctx.session.activeOrganizationId,
			});
		}),

	get: protectedProcedure
		.input(apiFindOneDoksCluster)
		.query(async ({ ctx, input }) => {
			await verifyClusterOwnership(input.doksClusterId, ctx.session.activeOrganizationId);
			return findDoksClusterById(input.doksClusterId);
		}),

	getByOrg: protectedProcedure.query(async ({ ctx }) => {
		return findDoksClusterByOrgId(ctx.session.activeOrganizationId);
	}),

	status: protectedProcedure
		.input(apiFindOneDoksCluster)
		.query(async ({ ctx, input }) => {
			await verifyClusterOwnership(input.doksClusterId, ctx.session.activeOrganizationId);
			return getDoksClusterStatus(input.doksClusterId);
		}),

	kubeconfig: protectedProcedure
		.input(apiFindOneDoksCluster)
		.query(async ({ ctx, input }) => {
			await verifyClusterOwnership(input.doksClusterId, ctx.session.activeOrganizationId);
			return getDoksKubeconfig(input.doksClusterId);
		}),

	delete: protectedProcedure
		.input(apiDeleteDoksCluster)
		.mutation(async ({ ctx, input }) => {
			await verifyClusterOwnership(input.doksClusterId, ctx.session.activeOrganizationId);
			await deleteDoksCluster(input.doksClusterId);
			return { success: true };
		}),

	upgradeToHA: protectedProcedure
		.input(apiFindOneDoksCluster)
		.mutation(async ({ ctx, input }) => {
			await verifyClusterOwnership(input.doksClusterId, ctx.session.activeOrganizationId);
			return upgradeToHA(input.doksClusterId);
		}),

	// ========================================================================
	// Node Pools
	// ========================================================================

	addNodePool: protectedProcedure
		.input(apiAddNodePool)
		.mutation(async ({ ctx, input }) => {
			await verifyClusterOwnership(input.doksClusterId, ctx.session.activeOrganizationId);
			return addNodePool(input);
		}),

	updateNodePool: protectedProcedure
		.input(apiUpdateNodePool)
		.mutation(async ({ ctx, input }) => {
			await verifyClusterOwnership(input.doksClusterId, ctx.session.activeOrganizationId);
			return updateNodePool(input);
		}),

	deleteNodePool: protectedProcedure
		.input(apiDeleteNodePool)
		.mutation(async ({ ctx, input }) => {
			await verifyClusterOwnership(input.doksClusterId, ctx.session.activeOrganizationId);
			await deleteNodePool(input.doksClusterId, input.poolId);
			return { success: true };
		}),

	// ========================================================================
	// Fleet Operations (Admin only)
	// ========================================================================

	list: adminProcedure.query(async () => {
		return listDoksClusters();
	}),

	sync: adminProcedure.mutation(async () => {
		return syncDoksFleet();
	}),

	listNodeSizes: protectedProcedure.query(async () => {
		return listNodeSizes();
	}),

	listRegions: protectedProcedure.query(async () => {
		return listRegions();
	}),

	// ========================================================================
	// Billing
	// ========================================================================

	clusterCost: protectedProcedure
		.input(apiFindOneDoksCluster)
		.query(async ({ ctx, input }) => {
			await verifyClusterOwnership(input.doksClusterId, ctx.session.activeOrganizationId);
			return calculateClusterCost(input.doksClusterId);
		}),

	orgBilling: protectedProcedure.query(async ({ ctx }) => {
		return getOrgBilling(ctx.session.activeOrganizationId);
	}),

	fleetBilling: adminProcedure.query(async () => {
		return getFleetBilling();
	}),

	recordSnapshot: protectedProcedure.mutation(async ({ ctx }) => {
		return recordBillingSnapshot(ctx.session.activeOrganizationId);
	}),
});
