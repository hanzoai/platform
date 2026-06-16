/**
 * utils/zap-deploy-provider.ts — native ZAP RPC client (browser) for the
 * DeployProvider capability. Replaces the tRPC `api.deployProvider.*` surface.
 *
 * Opens a single WebSocket to `/zap/deploy-provider` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated DeployProviderMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { DeployProviderMethod } from "@/server/zap/schema/deploy-provider_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/deploy-provider");

// Every DeployProvider method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const all = rpc.query(DeployProviderMethod.all, "all", args);
const one = rpc.query(DeployProviderMethod.one, "one", args);

export const deployProvider = {
	create: rpc.mutation(DeployProviderMethod.create, args),
	one,
	all,
	update: rpc.mutation(DeployProviderMethod.update, args),
	remove: rpc.mutation(DeployProviderMethod.remove, args),
	testConnection: rpc.mutation(DeployProviderMethod.testConnection, args),
	useUtils: makeUseUtils({ all, one }),
} as const;
