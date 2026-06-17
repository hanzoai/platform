# swarm.zap — swarm capability.
#
# Native ZAP schema replacing the tRPC `swarmRouter`
# (server/api/routers/swarm.ts). Every method was
# `withPermission("server", "read")` — an authenticated caller whose body
# additionally enforces per-server org ownership (getContainerStats). Inputs are
# Zod objects carried via the shared Args struct (../args.ts); return values via
# the shared Result struct (../result.ts). This schema declares only the method
# ordinals — the request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/swarm.zap -out schema/`.

package swarm

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Swarm {
  getNodes(args: Args) returns (result: Result)
  getNodeInfo(args: Args) returns (result: Result)
  getNodeApps(args: Args) returns (result: Result)
  getAppInfos(args: Args) returns (result: Result)
  getContainerStats(args: Args) returns (result: Result)
}
