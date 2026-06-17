# k8s.zap — Kubernetes deploy capability.
#
# Native ZAP schema replacing the tRPC `k8sRouter`
# (server/api/routers/k8s.ts). Every method was `protectedProcedure` — an
# authenticated (session+user) caller. Inputs (namespace + ApplicationSpec /
# teardown / status / logs / stack params) ride the shared Args carrier
# (../args.ts); return values the shared Result carrier (../result.ts). This
# schema declares only the method ordinals — the request/response payloads ride
# the generic carriers. Compiled by `zapgen schema/k8s.zap -out schema/`.

package k8s

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface K8s {
  deploy(args: Args) returns (result: Result)
  teardown(args: Args) returns (result: Result)
  status(args: Args) returns (result: Result)
  logs(args: Args) returns (result: Result)
  deployStack(args: Args) returns (result: Result)
}
