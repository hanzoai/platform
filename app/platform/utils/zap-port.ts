/**
 * utils/zap-port.ts — native ZAP RPC client (browser) for the Port capability.
 * Replaces the tRPC `api.port.*` surface.
 *
 * Opens a single WebSocket to `/zap/port` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated PortMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { PortMethod } from "@/server/zap/schema/port_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/port");

// Every Port method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(PortMethod.one, "one", args);

export const port = {
	create: rpc.mutation(PortMethod.create, args),
	one,
	delete: rpc.mutation(PortMethod.delete, args),
	update: rpc.mutation(PortMethod.update, args),
	useUtils: makeUseUtils({ one }),
} as const;
