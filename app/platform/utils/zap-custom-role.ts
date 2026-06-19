/**
 * utils/zap-custom-role.ts — native ZAP RPC client (browser) for the CustomRole
 * capability (ENTERPRISE). Replaces the tRPC `api.customRole.*` surface.
 *
 * Opens a single WebSocket to `/zap/custom-role` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated CustomRoleMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { CustomRoleMethod } from "@/server/zap/schema/custom-role_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/custom-role");

// Every CustomRole method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const all = rpc.query(CustomRoleMethod.all, "all", args);
const membersByRole = rpc.query(
	CustomRoleMethod.membersByRole,
	"membersByRole",
	args,
);
const getStatements = rpc.query(
	CustomRoleMethod.getStatements,
	"getStatements",
	args,
);

export const customRole = {
	all,
	create: rpc.mutation(CustomRoleMethod.create, args),
	update: rpc.mutation(CustomRoleMethod.update, args),
	remove: rpc.mutation(CustomRoleMethod.remove, args),
	membersByRole,
	getStatements,
	useUtils: makeUseUtils({ all, membersByRole, getStatements }),
} as const;
