/**
 * utils/zap-swarm.ts — native ZAP RPC client (browser) for the Swarm
 * capability. Replaces the tRPC `api.swarm.*` surface.
 *
 * Opens a single WebSocket to `/zap/swarm` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated SwarmMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { SwarmMethod } from "@/server/zap/schema/swarm_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/swarm");

// Every Swarm method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const getNodes = rpc.query(SwarmMethod.getNodes, "getNodes", args);
const getNodeInfo = rpc.query(SwarmMethod.getNodeInfo, "getNodeInfo", args);
const getNodeApps = rpc.query(SwarmMethod.getNodeApps, "getNodeApps", args);
const getAppInfos = rpc.query(SwarmMethod.getAppInfos, "getAppInfos", args);
const getContainerStats = rpc.query(
	SwarmMethod.getContainerStats,
	"getContainerStats",
	args,
);

export const swarm = {
	getNodes,
	getNodeInfo,
	getNodeApps,
	getAppInfos,
	getContainerStats,
	useUtils: makeUseUtils({
		getNodes,
		getNodeInfo,
		getNodeApps,
		getAppInfos,
		getContainerStats,
	}),
} as const;
