/**
 * utils/zap-mount.ts — native ZAP RPC client (browser) for the Mount
 * capability. Replaces the tRPC `api.mount.*` surface.
 *
 * Opens a single WebSocket to `/zap/mount` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated MountMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { MountMethod } from "@/server/zap/schema/mount_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/mount");

// Every Mount method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(MountMethod.one, "one", args);
const allNamedByApplicationId = rpc.query(
	MountMethod.allNamedByApplicationId,
	"allNamedByApplicationId",
	args,
);
const listByServiceId = rpc.query(
	MountMethod.listByServiceId,
	"listByServiceId",
	args,
);

export const mount = {
	create: rpc.mutation(MountMethod.create, args),
	remove: rpc.mutation(MountMethod.remove, args),
	update: rpc.mutation(MountMethod.update, args),
	one,
	allNamedByApplicationId,
	listByServiceId,
	useUtils: makeUseUtils({ one, allNamedByApplicationId, listByServiceId }),
} as const;
