# mongo.zap — MongoDB database service capability.
#
# Native ZAP schema replacing the tRPC `mongoRouter`
# (server/api/routers/mongo.ts). Every method was `protectedProcedure` — an
# authenticated caller whose body additionally enforces per-service access
# (checkServiceAccess / checkServicePermissionAndAccess) and org ownership.
# Inputs are Zod objects carried via the shared Args struct (../args.ts); return
# values via the shared Result struct (../result.ts). This schema declares only
# the method ordinals — the request/response payloads ride the generic carriers.
# Compiled by `zapgen schema/mongo.zap -out schema/`.

package mongo

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Mongo {
  create(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  start(args: Args) returns (result: Result)
  stop(args: Args) returns (result: Result)
  saveExternalPort(args: Args) returns (result: Result)
  deploy(args: Args) returns (result: Result)
  deployWithLogs(args: Args) returns (result: Result)
  changeStatus(args: Args) returns (result: Result)
  reload(args: Args) returns (result: Result)
  remove(args: Args) returns (result: Result)
  saveEnvironment(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  changePassword(args: Args) returns (result: Result)
  move(args: Args) returns (result: Result)
  rebuild(args: Args) returns (result: Result)
  search(args: Args) returns (result: Result)
  readLogs(args: Args) returns (result: Result)
}
