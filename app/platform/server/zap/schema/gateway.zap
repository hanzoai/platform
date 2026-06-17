# gateway.zap — Gateway (hanzoai/gateway) admin capability.
#
# Native ZAP schema replacing the tRPC `gatewayRouter`
# (server/api/routers/gateway.ts). Every method is admin-gated. Inputs are
# Drizzle-derived Zod schemas (apiCreate/Update/FindRateLimitRule,
# apiCreate/Update/FindRoutingRule) carried via the shared Args struct
# (../args.ts); return values via the shared Result struct (../result.ts). This
# schema declares only the method ordinals — the request/response payloads ride
# the generic carriers. Compiled by `zapgen schema/gateway.zap -out schema/`.

package gateway

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Gateway {
  status(args: Args) returns (result: Result)
  listRateLimits(args: Args) returns (result: Result)
  createRateLimit(args: Args) returns (result: Result)
  updateRateLimit(args: Args) returns (result: Result)
  deleteRateLimit(args: Args) returns (result: Result)
  listRoutes(args: Args) returns (result: Result)
  createRoute(args: Args) returns (result: Result)
  updateRoute(args: Args) returns (result: Result)
  deleteRoute(args: Args) returns (result: Result)
}
