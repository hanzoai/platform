/**
 * utils/zap-volume-backups.ts — native ZAP RPC client (browser) for the
 * VolumeBackups capability. Replaces the tRPC `api.volumeBackups.*` surface.
 *
 * Opens a single WebSocket to `/zap/volume-backups` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated VolumeBackupsMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { VolumeBackupsMethod } from "@/server/zap/schema/volume-backups_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/volume-backups");

// Every VolumeBackups method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const list = rpc.query(VolumeBackupsMethod.list, "list", args);
const one = rpc.query(VolumeBackupsMethod.one, "one", args);

export const volumeBackups = {
	list,
	create: rpc.mutation(VolumeBackupsMethod.create, args),
	one,
	delete: rpc.mutation(VolumeBackupsMethod.delete, args),
	update: rpc.mutation(VolumeBackupsMethod.update, args),
	runManually: rpc.mutation(VolumeBackupsMethod.runManually, args),
	restoreVolumeBackupWithLogs: rpc.mutation(
		VolumeBackupsMethod.restoreVolumeBackupWithLogs,
		args,
	),
	useUtils: makeUseUtils({ list, one }),
} as const;
