/**
 * utils/zap-rollback.ts — native ZAP RPC client (browser) for the Rollback
 * capability. Replaces the tRPC `api.rollback.*` surface.
 *
 * Opens a single WebSocket to `/zap/rollback` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated RollbackMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { RollbackMethod } from "@/server/zap/schema/rollback_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/rollback");

// Every Rollback method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

export const rollback = {
	delete: rpc.mutation(RollbackMethod.delete, args),
	rollback: rpc.mutation(RollbackMethod.rollback, args),
	useUtils: makeUseUtils({}),
} as const;
