/**
 * utils/zap-redirects.ts — native ZAP RPC client (browser) for the Redirects
 * capability. Replaces the tRPC `api.redirects.*` surface.
 *
 * Opens a single WebSocket to `/zap/redirects` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated RedirectsMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { RedirectsMethod } from "@/server/zap/schema/redirects_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/redirects");

// Every Redirects method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(RedirectsMethod.one, "one", args);

export const redirects = {
	create: rpc.mutation(RedirectsMethod.create, args),
	one,
	delete: rpc.mutation(RedirectsMethod.delete, args),
	update: rpc.mutation(RedirectsMethod.update, args),
	useUtils: makeUseUtils({ one }),
} as const;
