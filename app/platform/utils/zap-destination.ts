/**
 * utils/zap-destination.ts — native ZAP RPC client (browser) for the
 * Destination capability. Replaces the tRPC `api.destination.*` surface.
 *
 * Opens a single WebSocket to `/zap/destination` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated DestinationMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import type { Destination } from "@hanzo/platform/services/destination";
import { encodeArgs } from "@/server/zap/args";
import { DestinationMethod } from "@/server/zap/schema/destination_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/destination");

// Every Destination method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query<Record<string, unknown>, Destination>(
	DestinationMethod.one,
	"one",
	args,
);
const all = rpc.query<Record<string, unknown>, Destination[]>(
	DestinationMethod.all,
	"all",
	args,
);

export const destination = {
	create: rpc.mutation(DestinationMethod.create, args),
	testConnection: rpc.mutation(DestinationMethod.testConnection, args),
	one,
	all,
	remove: rpc.mutation(DestinationMethod.remove, args),
	update: rpc.mutation(DestinationMethod.update, args),
	useUtils: makeUseUtils({ one, all }),
} as const;
