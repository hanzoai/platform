# compose.zap — Docker Compose service capability.
#
# Native ZAP schema replacing the tRPC `composeRouter`
# (server/api/routers/compose.ts). Every method was a `protectedProcedure`
# (authenticated caller, session+user) whose body additionally enforces
# per-compose org ownership / service permission via checkServiceAccess /
# checkServicePermissionAndAccess. Inputs are Zod objects carried via the shared
# Args struct (../args.ts); return values via the shared Result struct
# (../result.ts). This schema declares only the method ordinals — the
# request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/compose.zap -out schema/`.

package compose

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Compose {
  create(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  saveEnvironment(args: Args) returns (result: Result)
  delete(args: Args) returns (result: Result)
  cleanQueues(args: Args) returns (result: Result)
  clearDeployments(args: Args) returns (result: Result)
  killBuild(args: Args) returns (result: Result)
  loadServices(args: Args) returns (result: Result)
  loadMountsByService(args: Args) returns (result: Result)
  fetchSourceType(args: Args) returns (result: Result)
  randomizeCompose(args: Args) returns (result: Result)
  isolatedDeployment(args: Args) returns (result: Result)
  getConvertedCompose(args: Args) returns (result: Result)
  deploy(args: Args) returns (result: Result)
  redeploy(args: Args) returns (result: Result)
  stop(args: Args) returns (result: Result)
  start(args: Args) returns (result: Result)
  getDefaultCommand(args: Args) returns (result: Result)
  refreshToken(args: Args) returns (result: Result)
  deployTemplate(args: Args) returns (result: Result)
  templates(args: Args) returns (result: Result)
  getTags(args: Args) returns (result: Result)
  disconnectGitProvider(args: Args) returns (result: Result)
  move(args: Args) returns (result: Result)
  processTemplate(args: Args) returns (result: Result)
  previewTemplate(args: Args) returns (result: Result)
  import(args: Args) returns (result: Result)
  cancelDeployment(args: Args) returns (result: Result)
  search(args: Args) returns (result: Result)
  readLogs(args: Args) returns (result: Result)
}
