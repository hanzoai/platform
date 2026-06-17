/**
 * utils/zap-git-provider.ts — native ZAP RPC client (browser) for the
 * GitProvider capability. Replaces the tRPC `api.gitProvider.*` surface.
 *
 * Opens a single WebSocket to `/zap/git-provider` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated GitProviderMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { GitProviderMethod } from "@/server/zap/schema/git-provider_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/git-provider");

// Every GitProvider method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const getAll = rpc.query(GitProviderMethod.getAll, "getAll", args);
const allForPermissions = rpc.query(
	GitProviderMethod.allForPermissions,
	"allForPermissions",
	args,
);

export const gitProvider = {
	getAll,
	toggleShare: rpc.mutation(GitProviderMethod.toggleShare, args),
	allForPermissions,
	remove: rpc.mutation(GitProviderMethod.remove, args),
	useUtils: makeUseUtils({ getAll, allForPermissions }),
} as const;
