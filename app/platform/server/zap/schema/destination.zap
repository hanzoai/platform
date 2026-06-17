# destination.zap — S3 backup destination capability.
#
# Native ZAP schema replacing the tRPC `destinationRouter`
# (server/api/routers/destination.ts). Every method was
# `withPermission("destination", <action>)` — an authenticated caller whose body
# additionally enforces per-destination org ownership. Inputs are Zod objects
# carried via the shared Args struct (../args.ts); return values via the shared
# Result struct (../result.ts). This schema declares only the method ordinals —
# the request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/destination.zap -out schema/`.

package destination

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Destination {
  create(args: Args) returns (result: Result)
  testConnection(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  all(args: Args) returns (result: Result)
  remove(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
}
