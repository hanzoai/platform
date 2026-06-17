/**
 * utils/zap-cluster.ts — native ZAP RPC client (browser) for the Cluster
 * capability. Replaces the tRPC `api.cluster.*` surface.
 *
 * Opens a single WebSocket to `/zap/cluster` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated ClusterMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { ClusterMethod } from "@/server/zap/schema/cluster_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/cluster");

// Every Cluster method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const getNodes = rpc.query(ClusterMethod.getNodes, "getNodes", args);
const addWorker = rpc.query(ClusterMethod.addWorker, "addWorker", args);
const addManager = rpc.query(ClusterMethod.addManager, "addManager", args);

export const cluster = {
	getNodes,
	removeWorker: rpc.mutation(ClusterMethod.removeWorker, args),
	addWorker,
	addManager,
	useUtils: makeUseUtils({ getNodes, addWorker, addManager }),
} as const;
