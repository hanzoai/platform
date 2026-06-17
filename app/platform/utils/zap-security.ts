/**
 * utils/zap-security.ts — native ZAP RPC client (browser) for the Security
 * capability. Replaces the tRPC `api.security.*` surface.
 *
 * Opens a single WebSocket to `/zap/security` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated SecurityMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { SecurityMethod } from "@/server/zap/schema/security_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/security");

// Every Security method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(SecurityMethod.one, "one", args);

export const security = {
	create: rpc.mutation(SecurityMethod.create, args),
	one,
	delete: rpc.mutation(SecurityMethod.delete, args),
	update: rpc.mutation(SecurityMethod.update, args),
	useUtils: makeUseUtils({ one }),
} as const;
