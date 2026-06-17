# environment.zap — Environment capability.
#
# Native ZAP schema replacing the tRPC `environmentRouter`
# (server/api/routers/environment.ts). Every method is `protectedProcedure`; the
# org-ownership, member-access and permission checks ride verbatim inside
# dispatch (environment-cap.ts). Inputs are Zod objects carried via the shared
# Args struct (../args.ts); return values via the shared Result struct
# (../result.ts). This schema declares only the method ordinals — the
# request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/environment.zap -out schema/`.

package environment

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Environment {
  create(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  byProjectId(args: Args) returns (result: Result)
  remove(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  duplicate(args: Args) returns (result: Result)
  search(args: Args) returns (result: Result)
}
