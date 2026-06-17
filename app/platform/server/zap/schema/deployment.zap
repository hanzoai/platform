# deployment.zap — deployment capability.
#
# Native ZAP schema replacing the tRPC `deploymentRouter`
# (server/api/routers/deployment.ts). Methods mix `protectedProcedure` and
# `withPermission("deployment", <action>)` — an authenticated caller whose body
# additionally enforces per-service permission / per-server org ownership.
# Inputs are Zod objects carried via the shared Args struct (../args.ts); return
# values via the shared Result struct (../result.ts). This schema declares only
# the method ordinals — the request/response payloads ride the generic carriers.
# Compiled by `zapgen schema/deployment.zap -out schema/`.

package deployment

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Deployment {
  all(args: Args) returns (result: Result)
  allByCompose(args: Args) returns (result: Result)
  allByServer(args: Args) returns (result: Result)
  allCentralized(args: Args) returns (result: Result)
  queueList(args: Args) returns (result: Result)
  allByType(args: Args) returns (result: Result)
  killProcess(args: Args) returns (result: Result)
  removeDeployment(args: Args) returns (result: Result)
  readLogs(args: Args) returns (result: Result)
}
