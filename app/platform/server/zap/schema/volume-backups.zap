# volume-backups.zap — volume-backup capability.
#
# Native ZAP schema replacing the tRPC `volumeBackupsRouter`
# (server/api/routers/volume-backups.ts). Every method was a
# `protectedProcedure` (authenticated caller) — except
# restoreVolumeBackupWithLogs, a `withPermission("volumeBackup", "restore")` —
# whose body additionally enforces per-service org ownership. Inputs are Zod
# objects carried via the shared Args struct (../args.ts); return values via the
# shared Result struct (../result.ts). This schema declares only the method
# ordinals — the request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/volume-backups.zap -out schema/`.

package volumebackups

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface VolumeBackups {
  list(args: Args) returns (result: Result)
  create(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  delete(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  runManually(args: Args) returns (result: Result)
  restoreVolumeBackupWithLogs(args: Args) returns (result: Result)
}
