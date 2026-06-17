/**
 * utils/zap-deployment.ts — native ZAP RPC client (browser) for the Deployment
 * capability. Replaces the tRPC `api.deployment.*` surface.
 *
 * Opens a single WebSocket to `/zap/deployment` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated DeploymentMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { DeploymentMethod } from "@/server/zap/schema/deployment_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/deployment");

// Every Deployment method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const all = rpc.query(DeploymentMethod.all, "all", args);
const allByCompose = rpc.query(DeploymentMethod.allByCompose, "allByCompose", args);
const allByServer = rpc.query(DeploymentMethod.allByServer, "allByServer", args);
const allCentralized = rpc.query(
	DeploymentMethod.allCentralized,
	"allCentralized",
	args,
);
const queueList = rpc.query(DeploymentMethod.queueList, "queueList", args);
const allByType = rpc.query(DeploymentMethod.allByType, "allByType", args);
const readLogs = rpc.query(DeploymentMethod.readLogs, "readLogs", args);

export const deployment = {
	all,
	allByCompose,
	allByServer,
	allCentralized,
	queueList,
	allByType,
	killProcess: rpc.mutation(DeploymentMethod.killProcess, args),
	removeDeployment: rpc.mutation(DeploymentMethod.removeDeployment, args),
	readLogs,
	useUtils: makeUseUtils({
		all,
		allByCompose,
		allByServer,
		allCentralized,
		queueList,
		allByType,
		readLogs,
	}),
} as const;
