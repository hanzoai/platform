/**
 * utils/zap-whitelabeling.ts — native ZAP RPC client (browser) for the
 * Whitelabeling capability. Replaces the tRPC `api.whitelabeling.*` surface.
 *
 * Opens a single WebSocket to `/zap/whitelabeling` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated WhitelabelingMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes per-query
 * invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { WhitelabelingMethod } from "@/server/zap/schema/whitelabeling_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/whitelabeling");

// Every Whitelabeling method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const get = rpc.query(WhitelabelingMethod.get, "get", args);
const getPublic = rpc.query(WhitelabelingMethod.getPublic, "getPublic", args);

export const whitelabeling = {
	get,
	update: rpc.mutation(WhitelabelingMethod.update, args),
	reset: rpc.mutation(WhitelabelingMethod.reset, args),
	getPublic,
	useUtils: makeUseUtils({ get, getPublic }),
} as const;
