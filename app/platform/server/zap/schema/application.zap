# application.zap — application service capability.
#
# Native ZAP schema replacing the tRPC `applicationRouter`
# (server/api/routers/application.ts). Every method was a `protectedProcedure`
# (or `withPermission("monitoring", "read")` for readAppMonitoring) whose body
# additionally enforces per-service org ownership / service permission via
# checkServiceAccess / checkServicePermissionAndAccess. Inputs are Zod objects
# carried via the shared Args struct (../args.ts); return values via the shared
# Result struct (../result.ts). This schema declares only the method ordinals —
# the request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/application.zap -out schema/`.

package application

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Application {
  create(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  reload(args: Args) returns (result: Result)
  delete(args: Args) returns (result: Result)
  stop(args: Args) returns (result: Result)
  start(args: Args) returns (result: Result)
  redeploy(args: Args) returns (result: Result)
  saveEnvironment(args: Args) returns (result: Result)
  saveBuildType(args: Args) returns (result: Result)
  saveGithubProvider(args: Args) returns (result: Result)
  saveGitlabProvider(args: Args) returns (result: Result)
  saveBitbucketProvider(args: Args) returns (result: Result)
  saveGiteaProvider(args: Args) returns (result: Result)
  saveDockerProvider(args: Args) returns (result: Result)
  saveGitProvider(args: Args) returns (result: Result)
  disconnectGitProvider(args: Args) returns (result: Result)
  markRunning(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  refreshToken(args: Args) returns (result: Result)
  deploy(args: Args) returns (result: Result)
  cleanQueues(args: Args) returns (result: Result)
  clearDeployments(args: Args) returns (result: Result)
  killBuild(args: Args) returns (result: Result)
  readTraefikConfig(args: Args) returns (result: Result)
  dropDeployment(args: Args) returns (result: Result)
  updateTraefikConfig(args: Args) returns (result: Result)
  readAppMonitoring(args: Args) returns (result: Result)
  move(args: Args) returns (result: Result)
  cancelDeployment(args: Args) returns (result: Result)
  search(args: Args) returns (result: Result)
  readLogs(args: Args) returns (result: Result)
}
