/**
 * utils/zap-admin.ts — native ZAP RPC client (browser) for the Admin
 * capability. Replaces the tRPC `api.admin.*` surface.
 *
 * Opens a single WebSocket to `/zap/admin` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated AdminMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils() (Admin has no
 * queries, so it is empty).
 */

import { encodeArgs } from "@/server/zap/args";
import { AdminMethod } from "@/server/zap/schema/admin_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/admin");

// Every Admin method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

export const admin = {
	setupMonitoring: rpc.mutation(AdminMethod.setupMonitoring, args),
	useUtils: makeUseUtils({}),
} as const;
