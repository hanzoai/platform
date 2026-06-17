/**
 * utils/zap-project.ts — native ZAP RPC client (browser) for the Project
 * capability. Replaces the tRPC `api.project.*` surface.
 *
 * Opens a single WebSocket to `/zap/project` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated ProjectMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes per-query
 * invalidation, mirroring tRPC's api.useUtils().
 */

import type { RouterOutputs } from "@/utils/api";
import { encodeArgs } from "@/server/zap/args";
import { ProjectMethod } from "@/server/zap/schema/project_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/project");

// Every Project method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query<Record<string, unknown>, RouterOutputs["project"]["one"]>(
	ProjectMethod.one,
	"one",
	args,
);
const all = rpc.query<Record<string, unknown>, RouterOutputs["project"]["all"]>(
	ProjectMethod.all,
	"all",
	args,
);
const allForPermissions = rpc.query<
	Record<string, unknown>,
	RouterOutputs["project"]["allForPermissions"]
>(ProjectMethod.allForPermissions, "allForPermissions", args);
const homeStats = rpc.query(ProjectMethod.homeStats, "homeStats", args);
const search = rpc.query(ProjectMethod.search, "search", args);

export const project = {
	create: rpc.mutation(ProjectMethod.create, args),
	one,
	all,
	allForPermissions,
	homeStats,
	search,
	remove: rpc.mutation(ProjectMethod.remove, args),
	update: rpc.mutation(ProjectMethod.update, args),
	duplicate: rpc.mutation(ProjectMethod.duplicate, args),
	useUtils: makeUseUtils({ one, all, allForPermissions, homeStats, search }),
} as const;
