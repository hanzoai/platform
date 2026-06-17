# backup.zap — database/compose backup capability.
#
# Native ZAP schema replacing the tRPC `backupRouter`
# (server/api/routers/backup.ts). Every method was either a
# `protectedProcedure` (authenticated caller whose body enforces per-backup org
# ownership) or `withPermission("backup", <action>)` (listBackupFiles).
# `restoreBackupWithLogs` was a tRPC `.subscription()` — its emitted log lines
# are collected into an array and returned via the shared Result carrier. Inputs
# are Zod objects carried via the shared Args struct (../args.ts); return values
# via the shared Result struct (../result.ts). This schema declares only the
# method ordinals — the request/response payloads ride the generic carriers.
# Compiled by `zapgen schema/backup.zap -out schema/`.

package backup

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Backup {
  create(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  remove(args: Args) returns (result: Result)
  manualBackupPostgres(args: Args) returns (result: Result)
  manualBackupMySql(args: Args) returns (result: Result)
  manualBackupMariadb(args: Args) returns (result: Result)
  manualBackupCompose(args: Args) returns (result: Result)
  manualBackupMongo(args: Args) returns (result: Result)
  manualBackupLibsql(args: Args) returns (result: Result)
  listBackupFiles(args: Args) returns (result: Result)
  restoreBackupWithLogs(args: Args) returns (result: Result)
}
