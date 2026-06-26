/**
 * dedicated-cluster router — launch + manage a customer org's own "Hanzo K8S"
 * cluster from the control plane.
 *
 * Every procedure is admin-gated (`adminProcedure`: owner|admin) AND scoped to
 * the caller's active organization — a dedicated cluster is org-owned
 * infrastructure, so provisioning/selecting it is an org-admin action and every
 * cluster-ref op verifies the cluster belongs to the active org.
 *
 * This is the tRPC half of the surface; the REST mirror (service-token, for the
 * console/automation) lives under pages/api/v1/org/[orgId]/cluster/*. Both call
 * the same `services/dedicated-cluster` functions — one implementation.
 */

import {
	apiDedicatedClusterRef,
	apiProvisionDedicatedCluster,
} from "@hanzo/platform/db/schema";
import {
	type DoksCluster,
	findDoksClusterById,
} from "@hanzo/platform/services/doks-provisioner";
import {
	attachExternalCluster,
	installClusterBaseline,
	listOrgClusters,
	migrateOrgToDedicated,
	provisionDedicatedCluster,
	redactTarget,
	resolveOrgClusterTarget,
	selectDeployTarget,
} from "@hanzo/platform/services/dedicated-cluster";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, createTRPCRouter } from "@/server/api/trpc";

/** Resolve the caller's active org or 400 — every op here is org-scoped. */
function requireActiveOrg(ctx: {
	session: { activeOrganizationId?: string | null };
}): string {
	const org = ctx.session.activeOrganizationId;
	if (!org) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "No active organization on the session",
		});
	}
	return org;
}

/** Load a cluster and assert it belongs to the active org. */
async function loadOwned(
	doksClusterId: string,
	organizationId: string,
): Promise<DoksCluster> {
	const cluster = await findDoksClusterById(doksClusterId);
	if (cluster.organizationId !== organizationId) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Cluster belongs to a different organization",
		});
	}
	return cluster;
}

export const dedicatedClusterRouter = createTRPCRouter({
	/** Provision a dedicated DOKS cluster for the active org. */
	provision: adminProcedure
		.input(apiProvisionDedicatedCluster)
		.mutation(async ({ input, ctx }) => {
			const organizationId = requireActiveOrg(ctx);
			return provisionDedicatedCluster({ ...input, organizationId });
		}),

	/** Install the hanzo-operator + per-tenant baseline onto a running cluster. */
	installBaseline: adminProcedure
		.input(apiDedicatedClusterRef)
		.mutation(async ({ input, ctx }) => {
			const organizationId = requireActiveOrg(ctx);
			await loadOwned(input.doksClusterId, organizationId);
			return installClusterBaseline(input.doksClusterId);
		}),

	/**
	 * Attach an external (bring-your-own) cluster as a deploy target for the
	 * active org. The org is forced from the session; the kubeconfig is sealed
	 * at rest. The created cluster is ready to `select` immediately.
	 */
	attachExternal: adminProcedure
		.input(z.object({ name: z.string().min(1), kubeconfig: z.string().min(1) }))
		.mutation(async ({ input, ctx }) => {
			const organizationId = requireActiveOrg(ctx);
			return attachExternalCluster({ ...input, organizationId });
		}),

	/** List the active org's dedicated clusters. */
	list: adminProcedure.query(async ({ ctx }) => {
		return listOrgClusters(requireActiveOrg(ctx));
	}),

	/** Get one dedicated cluster (org-scoped). */
	get: adminProcedure
		.input(apiDedicatedClusterRef)
		.query(async ({ input, ctx }) => {
			return loadOwned(input.doksClusterId, requireActiveOrg(ctx));
		}),

	/** Select the active deploy target (a dedicated cluster, or null = shared). */
	select: adminProcedure
		.input(z.object({ doksClusterId: z.string().min(1).nullable() }))
		.mutation(async ({ input, ctx }) => {
			const organizationId = requireActiveOrg(ctx);
			await selectDeployTarget(organizationId, input.doksClusterId);
			return redactTarget(await resolveOrgClusterTarget(organizationId));
		}),

	/** Re-point the org from the shared cluster to its dedicated one. */
	migrate: adminProcedure.mutation(async ({ ctx }) => {
		const organizationId = requireActiveOrg(ctx);
		const plan = await migrateOrgToDedicated(organizationId);
		return { ...plan, target: redactTarget(plan.target) };
	}),

	/** The org's current resolved deploy target (kubeconfig redacted). */
	target: adminProcedure.query(async ({ ctx }) => {
		return redactTarget(await resolveOrgClusterTarget(requireActiveOrg(ctx)));
	}),
});
