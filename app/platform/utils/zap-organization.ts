/**
 * utils/zap-organization.ts — native ZAP RPC client (browser) for the
 * Organization capability. Replaces the tRPC `api.organization.*` surface.
 *
 * Opens a single WebSocket to `/zap/organization` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated OrganizationMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes per-query
 * invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { OrganizationMethod } from "@/server/zap/schema/organization_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/organization");

// Every Organization method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const all = rpc.query(OrganizationMethod.all, "all", args);
const one = rpc.query(OrganizationMethod.one, "one", args);
const allInvitations = rpc.query(
	OrganizationMethod.allInvitations,
	"allInvitations",
	args,
);

export const organization = {
	create: rpc.mutation(OrganizationMethod.create, args),
	all,
	one,
	update: rpc.mutation(OrganizationMethod.update, args),
	delete: rpc.mutation(OrganizationMethod.delete, args),
	allInvitations,
	removeInvitation: rpc.mutation(OrganizationMethod.removeInvitation, args),
	useUtils: makeUseUtils({ all, one, allInvitations }),
} as const;
