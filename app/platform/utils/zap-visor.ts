/**
 * utils/zap-visor.ts — native ZAP RPC client (browser) for the Visor
 * capability. Replaces the tRPC `api.visor.*` surface.
 *
 * Opens a single WebSocket to `/zap/visor` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated VisorMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { VisorMethod } from "@/server/zap/schema/visor_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/visor");

// Every Visor method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const listMachines = rpc.query(VisorMethod.listMachines, "listMachines", args);
const getMachine = rpc.query(VisorMethod.getMachine, "getMachine", args);
const listProviders = rpc.query(
	VisorMethod.listProviders,
	"listProviders",
	args,
);
const listPlans = rpc.query(VisorMethod.listPlans, "listPlans", args);
const listNodePools = rpc.query(
	VisorMethod.listNodePools,
	"listNodePools",
	args,
);
const listVolumes = rpc.query(VisorMethod.listVolumes, "listVolumes", args);

export const visor = {
	listMachines,
	getMachine,
	createMachine: rpc.mutation(VisorMethod.createMachine, args),
	updateMachine: rpc.mutation(VisorMethod.updateMachine, args),
	deleteMachine: rpc.mutation(VisorMethod.deleteMachine, args),
	listProviders,
	listPlans,
	listNodePools,
	listVolumes,
	createVolume: rpc.mutation(VisorMethod.createVolume, args),
	deleteVolume: rpc.mutation(VisorMethod.deleteVolume, args),
	useUtils: makeUseUtils({
		listMachines,
		getMachine,
		listProviders,
		listPlans,
		listNodePools,
		listVolumes,
	}),
} as const;
