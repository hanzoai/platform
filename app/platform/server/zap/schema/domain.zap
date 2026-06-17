# domain.zap — domain capability.
#
# Native ZAP schema replacing the tRPC `domainRouter`
# (server/api/routers/domain.ts). Each method was either a
# `protectedProcedure` or a `withPermission("domain", <action>)` — an
# authenticated caller whose body additionally enforces per-service
# permission/access via checkServicePermissionAndAccess. Inputs are Zod objects
# carried via the shared Args struct (../args.ts); return values via the shared
# Result struct (../result.ts). This schema declares only the method ordinals —
# the request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/domain.zap -out schema/`.

package domain

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Domain {
  create(args: Args) returns (result: Result)
  byApplicationId(args: Args) returns (result: Result)
  byComposeId(args: Args) returns (result: Result)
  generateDomain(args: Args) returns (result: Result)
  canGenerateTraefikMeDomains(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  delete(args: Args) returns (result: Result)
  validateDomain(args: Args) returns (result: Result)
}
