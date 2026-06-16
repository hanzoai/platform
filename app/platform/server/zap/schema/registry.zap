# registry.zap — container registry capability.
#
# Native ZAP schema replacing the tRPC `registryRouter`
# (server/api/routers/registry.ts). Every method was
# `withPermission("registry", <action>)` — an authenticated caller whose body
# additionally enforces per-registry org ownership. Inputs are Zod objects
# carried via the shared Args struct (../args.ts); return values via the shared
# Result struct (../result.ts). This schema declares only the method ordinals —
# the request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/registry.zap -out schema/`.

package registry

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Registry {
  create(args: Args) returns (result: Result)
  remove(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  all(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  testRegistry(args: Args) returns (result: Result)
  testRegistryById(args: Args) returns (result: Result)
}
