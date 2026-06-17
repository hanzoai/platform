# security.zap — application basic-auth security capability.
#
# Native ZAP schema replacing the tRPC `securityRouter`
# (server/api/routers/security.ts). Every method was a `protectedProcedure`
# (authenticated caller) whose body additionally enforces per-application
# service permission via checkServicePermissionAndAccess. Inputs are Zod objects
# carried via the shared Args struct (../args.ts); return values via the shared
# Result struct (../result.ts). This schema declares only the method ordinals —
# the request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/security.zap -out schema/`.

package security

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Security {
  create(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  delete(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
}
