# ai.zap — AI provider settings + deployment-suggestion capability.
#
# Native ZAP schema replacing the tRPC `aiRouter`
# (server/api/routers/ai.ts). Methods mix `adminProcedure` (one/create/update/
# getAll/get/delete) and `protectedProcedure` (getModels/getEnabledProviders/
# analyzeLogs/testConnection/suggest/deploy). Inputs are Zod objects carried via
# the shared Args struct (../args.ts); return values via the shared Result struct
# (../result.ts). This schema declares only the method ordinals — the
# request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/ai.zap -out schema/`.

package ai

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Ai {
  one(args: Args) returns (result: Result)
  getModels(args: Args) returns (result: Result)
  create(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  getAll(args: Args) returns (result: Result)
  get(args: Args) returns (result: Result)
  delete(args: Args) returns (result: Result)
  getEnabledProviders(args: Args) returns (result: Result)
  analyzeLogs(args: Args) returns (result: Result)
  testConnection(args: Args) returns (result: Result)
  suggest(args: Args) returns (result: Result)
  deploy(args: Args) returns (result: Result)
}
