/**
 * utils/zap-backup.ts — native ZAP RPC client (browser) for the Backup
 * capability. Replaces the tRPC `api.backup.*` surface.
 *
 * Opens a single WebSocket to `/zap/backup` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated BackupMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { BackupMethod } from "@/server/zap/schema/backup_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/backup");

// Every Backup method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(BackupMethod.one, "one", args);

export const backup = {
	create: rpc.mutation(BackupMethod.create, args),
	one,
	update: rpc.mutation(BackupMethod.update, args),
	remove: rpc.mutation(BackupMethod.remove, args),
	manualBackupPostgres: rpc.mutation(BackupMethod.manualBackupPostgres, args),
	manualBackupMySql: rpc.mutation(BackupMethod.manualBackupMySql, args),
	manualBackupMariadb: rpc.mutation(BackupMethod.manualBackupMariadb, args),
	manualBackupCompose: rpc.mutation(BackupMethod.manualBackupCompose, args),
	manualBackupMongo: rpc.mutation(BackupMethod.manualBackupMongo, args),
	manualBackupLibsql: rpc.mutation(BackupMethod.manualBackupLibsql, args),
	listBackupFiles: rpc.query(
		BackupMethod.listBackupFiles,
		"listBackupFiles",
		args,
	),
	restoreBackupWithLogs: rpc.mutation(
		BackupMethod.restoreBackupWithLogs,
		args,
	),
	useUtils: makeUseUtils({ one }),
} as const;
