# rollback.zap — deployment rollback capability.
#
# Native ZAP schema replacing the tRPC `rollbackRouter`
# (server/api/routers/rollbacks.ts). Both methods were `protectedProcedure`
# mutations — an authenticated caller whose body additionally enforces per-
# rollback org ownership (delete) / service permission (rollback). Inputs are
# Zod objects carried via the shared Args struct (../args.ts); return values via
# the shared Result struct (../result.ts). This schema declares only the method
# ordinals — the request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/rollback.zap -out schema/`.

package rollback

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Rollback {
  delete(args: Args) returns (result: Result)
  rollback(args: Args) returns (result: Result)
}
