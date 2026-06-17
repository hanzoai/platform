/**
 * utils/zap-patch.ts — native ZAP RPC client (browser) for the Patch
 * capability. Replaces the tRPC `api.patch.*` surface.
 *
 * Opens a single WebSocket to `/zap/patch` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated PatchMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { PatchMethod } from "@/server/zap/schema/patch_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/patch");

// Every Patch method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(PatchMethod.one, "one", args);
const byEntityId = rpc.query(PatchMethod.byEntityId, "byEntityId", args);
const readRepoDirectories = rpc.query(
	PatchMethod.readRepoDirectories,
	"readRepoDirectories",
	args,
);
const readRepoFile = rpc.query(PatchMethod.readRepoFile, "readRepoFile", args);

export const patch = {
	create: rpc.mutation(PatchMethod.create, args),
	one,
	byEntityId,
	update: rpc.mutation(PatchMethod.update, args),
	delete: rpc.mutation(PatchMethod.delete, args),
	toggleEnabled: rpc.mutation(PatchMethod.toggleEnabled, args),
	ensureRepo: rpc.mutation(PatchMethod.ensureRepo, args),
	readRepoDirectories,
	readRepoFile,
	saveFileAsPatch: rpc.mutation(PatchMethod.saveFileAsPatch, args),
	markFileForDeletion: rpc.mutation(PatchMethod.markFileForDeletion, args),
	cleanPatchRepos: rpc.mutation(PatchMethod.cleanPatchRepos, args),
	useUtils: makeUseUtils({ one, byEntityId, readRepoDirectories, readRepoFile }),
} as const;
