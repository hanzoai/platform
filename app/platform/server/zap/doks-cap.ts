// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// doks-cap.ts — the native @zap-proto/web DOKS capability.
//
// This is the binary-ZAP replacement for the tRPC `doksRouter`
// (server/api/routers/doks.ts). It exposes:
//   - doksMintCap:  the bearer→ctx boundary at the WS upgrade. Mirrors the old
//                   `protectedProcedure` middleware — it runs validateRequest()
//                   on the upgrade request and returns the per-connection ctx
//                   (session + user). A null return rejects the upgrade with 401,
//                   so unauthenticated sockets never open (auth at the boundary).
//   - doksRootCap:  rootCap(ctx) → CallHandler. Dispatches each decoded ZAP Call
//                   by its method ordinal (doks.zap @n) to the same service
//                   functions the tRPC router called. No JSON-RPC, no tRPC.
//
// Method ordinals are the single source of truth in schema/doks.zap; the
// METHOD map below mirrors them and is what the browser client calls by name.

import type { IncomingMessage } from "node:http";
import { db } from "@hanzo/platform/db";
import { doksCluster } from "@hanzo/platform/db/schema";
import { validateRequest } from "@hanzo/platform/lib/auth";
import {
	calculateClusterCost,
	getFleetBilling,
	getOrgBilling,
	recordBillingSnapshot,
} from "@hanzo/platform/services/billing";
import {
	addNodePool,
	deleteDoksCluster,
	deleteNodePool,
	findDoksClusterById,
	findDoksClusterByOrgId,
	getDoksClusterStatus,
	getDoksKubeconfig,
	listDoksClusters,
	listNodeSizes,
	listRegions,
	provisionDoksCluster,
	syncDoksFleet,
	updateNodePool,
	upgradeToHA,
} from "@hanzo/platform/services/doks-provisioner";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { eq } from "drizzle-orm";
import {
	AddNodePoolParams,
	ClusterRef,
	DeleteNodePoolParams,
	decodeStruct,
	encodeResult,
	ProvisionParams,
	UpdateNodePoolParams,
} from "./codec";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface DoksCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
}

/** Method ordinals — mirror schema/doks.zap `@n`. */
export const DoksMethod = {
	provision: 0,
	get: 1,
	getByOrg: 2,
	status: 3,
	kubeconfig: 4,
	delete: 5,
	upgradeToHA: 6,
	addNodePool: 7,
	updateNodePool: 8,
	deleteNodePool: 9,
	list: 10,
	sync: 11,
	listNodeSizes: 12,
	listRegions: 13,
	clusterCost: 14,
	orgBilling: 15,
	fleetBilling: 16,
	recordSnapshot: 17,
} as const;

/**
 * doksMintCap — bearer→ctx boundary. Replaces `protectedProcedure`: validates
 * the upgrade request (session cookie / x-api-key) and returns the typed ctx.
 * Null → the upgrade is rejected with HTTP 401 before any WebSocket opens.
 */
export const doksMintCap: MintCap<DoksCtx> = async (req: IncomingMessage) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	if (!organizationId) return null;
	const userRole = ((user as { role?: string }).role ??
		"member") as DoksCtx["userRole"];
	return { organizationId, userRole };
};

/** Admin gate — mirrors `adminProcedure` (owner|admin only). */
function requireAdmin(ctx: DoksCtx): void {
	if (ctx.userRole !== "owner" && ctx.userRole !== "admin") {
		throw new AuthzError("admin role required");
	}
}

/** Typed authorization failure → ZAP Status.Forbidden / Unauthorized. */
class AuthzError extends Error {}
class NotFoundError extends Error {}

/** Ownership check — mirrors the old verifyClusterOwnership helper. */
async function verifyClusterOwnership(
	doksClusterId: string,
	organizationId: string,
) {
	const cluster = await db.query.doksCluster.findFirst({
		where: eq(doksCluster.doksClusterId, doksClusterId),
	});
	if (!cluster) throw new NotFoundError("DOKS cluster not found");
	if (cluster.organizationId !== organizationId) {
		throw new AuthzError("not authorized for this cluster");
	}
	return cluster;
}

/**
 * doksRootCap — the connection's dispatch root. For each decoded Call, decode
 * the params per the schema struct, run the matching service function (the very
 * same one the tRPC procedure ran), and encode the result. Errors map to ZAP
 * status codes, never a thrown HTTP 500 leak.
 */
export function doksRootCap(ctx: DoksCtx): CallHandler {
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
				err instanceof NotFoundError
					? Status.NotFound
					: err instanceof AuthzError
						? Status.Forbidden
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

async function dispatch(ctx: DoksCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case DoksMethod.provision: {
			const p = decodeStruct(ProvisionParams, call.payload) as {
				organizationId: string;
				region: string;
				ha: boolean;
				nodeSize: string;
				nodeCount: number;
			};
			return provisionDoksCluster({
				organizationId: p.organizationId || ctx.organizationId,
				region: p.region,
				ha: p.ha,
				...(p.nodeSize ? { nodeSize: p.nodeSize } : {}),
				...(p.nodeCount ? { nodeCount: p.nodeCount } : {}),
			});
		}
		case DoksMethod.get: {
			const { doksClusterId } = ref(call);
			await verifyClusterOwnership(doksClusterId, ctx.organizationId);
			return findDoksClusterById(doksClusterId);
		}
		case DoksMethod.getByOrg:
			return findDoksClusterByOrgId(ctx.organizationId);
		case DoksMethod.status: {
			const { doksClusterId } = ref(call);
			await verifyClusterOwnership(doksClusterId, ctx.organizationId);
			return getDoksClusterStatus(doksClusterId);
		}
		case DoksMethod.kubeconfig: {
			const { doksClusterId } = ref(call);
			await verifyClusterOwnership(doksClusterId, ctx.organizationId);
			return getDoksKubeconfig(doksClusterId);
		}
		case DoksMethod.delete: {
			const { doksClusterId } = ref(call);
			await verifyClusterOwnership(doksClusterId, ctx.organizationId);
			await deleteDoksCluster(doksClusterId);
			return { success: true };
		}
		case DoksMethod.upgradeToHA: {
			const { doksClusterId } = ref(call);
			await verifyClusterOwnership(doksClusterId, ctx.organizationId);
			return upgradeToHA(doksClusterId);
		}
		case DoksMethod.addNodePool: {
			const p = decodeStruct(AddNodePoolParams, call.payload) as {
				doksClusterId: string;
				name: string;
				size: string;
				count: number;
			};
			await verifyClusterOwnership(p.doksClusterId, ctx.organizationId);
			return addNodePool({
				doksClusterId: p.doksClusterId,
				name: p.name,
				...(p.size ? { size: p.size } : {}),
				...(p.count ? { count: p.count } : {}),
			});
		}
		case DoksMethod.updateNodePool: {
			const p = decodeStruct(UpdateNodePoolParams, call.payload) as {
				doksClusterId: string;
				poolId: string;
				count: number;
				size: string;
			};
			await verifyClusterOwnership(p.doksClusterId, ctx.organizationId);
			return updateNodePool({
				doksClusterId: p.doksClusterId,
				poolId: p.poolId,
				...(p.count ? { count: p.count } : {}),
				...(p.size ? { size: p.size } : {}),
			});
		}
		case DoksMethod.deleteNodePool: {
			const p = decodeStruct(DeleteNodePoolParams, call.payload) as {
				doksClusterId: string;
				poolId: string;
			};
			await verifyClusterOwnership(p.doksClusterId, ctx.organizationId);
			await deleteNodePool(p.doksClusterId, p.poolId);
			return { success: true };
		}
		case DoksMethod.list:
			requireAdmin(ctx);
			return listDoksClusters();
		case DoksMethod.sync:
			requireAdmin(ctx);
			return syncDoksFleet();
		case DoksMethod.listNodeSizes:
			return listNodeSizes();
		case DoksMethod.listRegions:
			return listRegions();
		case DoksMethod.clusterCost: {
			const { doksClusterId } = ref(call);
			await verifyClusterOwnership(doksClusterId, ctx.organizationId);
			return calculateClusterCost(doksClusterId);
		}
		case DoksMethod.orgBilling:
			return getOrgBilling(ctx.organizationId);
		case DoksMethod.fleetBilling:
			requireAdmin(ctx);
			return getFleetBilling();
		case DoksMethod.recordSnapshot:
			return recordBillingSnapshot(ctx.organizationId);
		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}

function ref(call: Call): { doksClusterId: string } {
	return decodeStruct(ClusterRef, call.payload) as { doksClusterId: string };
}
