/**
 * utils/zap-environment.ts — native ZAP RPC client (browser) for the
 * Environment capability. Replaces the tRPC `api.environment.*` surface.
 *
 * Opens a single WebSocket to `/zap/environment` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated EnvironmentMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes per-query
 * invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { EnvironmentMethod } from "@/server/zap/schema/environment_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/environment");

// Every Environment method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(EnvironmentMethod.one, "one", args);
const byProjectId = rpc.query(
	EnvironmentMethod.byProjectId,
	"byProjectId",
	args,
);
const search = rpc.query(EnvironmentMethod.search, "search", args);

export const environment = {
	create: rpc.mutation(EnvironmentMethod.create, args),
	one,
	byProjectId,
	remove: rpc.mutation(EnvironmentMethod.remove, args),
	update: rpc.mutation(EnvironmentMethod.update, args),
	duplicate: rpc.mutation(EnvironmentMethod.duplicate, args),
	search,
	useUtils: makeUseUtils({ one, byProjectId, search }),
} as const;
