/**
 * utils/zap-ssh-key.ts — native ZAP RPC client (browser) for the SshKey
 * capability. Replaces the tRPC `api.sshKey.*` surface.
 *
 * Opens a single WebSocket to `/zap/ssh-key` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated SshKeyMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { SshKeyMethod } from "@/server/zap/schema/ssh-key_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/ssh-key");

// Every SshKey method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const all = rpc.query(SshKeyMethod.all, "all", args);
const allForApps = rpc.query(SshKeyMethod.allForApps, "allForApps", args);
const one = rpc.query(SshKeyMethod.one, "one", args);

export const sshKey = {
	create: rpc.mutation(SshKeyMethod.create, args),
	remove: rpc.mutation(SshKeyMethod.remove, args),
	one,
	all,
	allForApps,
	generate: rpc.mutation(SshKeyMethod.generate, args),
	update: rpc.mutation(SshKeyMethod.update, args),
	useUtils: makeUseUtils({ all, allForApps, one }),
} as const;
