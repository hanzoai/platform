# cluster.zap — Docker Swarm cluster capability.
#
# Native ZAP schema replacing the tRPC `clusterRouter`
# (server/api/routers/cluster.ts). Every method was `withPermission("server",
# <action>)` — i.e. an authenticated (session+user) caller whose request body
# additionally enforces per-server org ownership. Inputs ride the shared Args
# carrier (../args.ts); return values the shared Result carrier (../result.ts).
# This schema declares only the method ordinals — the request/response payloads
# ride the generic carriers. Compiled by `zapgen schema/cluster.zap -out schema/`.

package cluster

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Cluster {
  getNodes(args: Args) returns (result: Result)
  removeWorker(args: Args) returns (result: Result)
  addWorker(args: Args) returns (result: Result)
  addManager(args: Args) returns (result: Result)
}
