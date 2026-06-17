# settings.zap — server settings capability.
#
# Native ZAP schema replacing the tRPC `settingsRouter`
# (server/api/routers/settings.ts). Methods are a mix of protectedProcedure
# (authenticated), adminProcedure / enterpriseProcedure (owner|admin only —
# enterpriseProcedure is an alias of adminProcedure on this branch), and
# publicProcedure (isCloud, health). The admin gate runs per-call inside
# dispatch via requireAdmin(ctx); the public methods skip it. Inputs are Zod
# objects carried via the shared Args struct (../args.ts); return values via the
# shared Result struct (../result.ts). This schema declares only the method
# ordinals — the request/response payloads ride the generic carriers. Compiled
# by `zapgen schema/settings.zap -out schema/`.

package settings

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Settings {
  getWebServerSettings(args: Args) returns (result: Result)
  reloadServer(args: Args) returns (result: Result)
  cleanRedis(args: Args) returns (result: Result)
  reloadRedis(args: Args) returns (result: Result)
  cleanAllDeploymentQueue(args: Args) returns (result: Result)
  reloadTraefik(args: Args) returns (result: Result)
  toggleDashboard(args: Args) returns (result: Result)
  cleanUnusedImages(args: Args) returns (result: Result)
  cleanUnusedVolumes(args: Args) returns (result: Result)
  cleanStoppedContainers(args: Args) returns (result: Result)
  cleanDockerBuilder(args: Args) returns (result: Result)
  cleanDockerPrune(args: Args) returns (result: Result)
  cleanAll(args: Args) returns (result: Result)
  cleanMonitoring(args: Args) returns (result: Result)
  getDockerDiskUsage(args: Args) returns (result: Result)
  saveSSHPrivateKey(args: Args) returns (result: Result)
  assignDomainServer(args: Args) returns (result: Result)
  cleanSSHPrivateKey(args: Args) returns (result: Result)
  updateDockerCleanup(args: Args) returns (result: Result)
  updateRemoteServersOnly(args: Args) returns (result: Result)
  updateEnforceSSO(args: Args) returns (result: Result)
  readTraefikConfig(args: Args) returns (result: Result)
  updateTraefikConfig(args: Args) returns (result: Result)
  readWebServerTraefikConfig(args: Args) returns (result: Result)
  updateWebServerTraefikConfig(args: Args) returns (result: Result)
  readMiddlewareTraefikConfig(args: Args) returns (result: Result)
  updateMiddlewareTraefikConfig(args: Args) returns (result: Result)
  getUpdateData(args: Args) returns (result: Result)
  updateServer(args: Args) returns (result: Result)
  getHanzoVersion(args: Args) returns (result: Result)
  getReleaseTag(args: Args) returns (result: Result)
  readDirectories(args: Args) returns (result: Result)
  updateTraefikFile(args: Args) returns (result: Result)
  readTraefikFile(args: Args) returns (result: Result)
  getIp(args: Args) returns (result: Result)
  updateServerIp(args: Args) returns (result: Result)
  getOpenApiDocument(args: Args) returns (result: Result)
  readTraefikEnv(args: Args) returns (result: Result)
  writeTraefikEnv(args: Args) returns (result: Result)
  haveTraefikDashboardPortEnabled(args: Args) returns (result: Result)
  readStatsLogs(args: Args) returns (result: Result)
  readStats(args: Args) returns (result: Result)
  haveActivateRequests(args: Args) returns (result: Result)
  toggleRequests(args: Args) returns (result: Result)
  isCloud(args: Args) returns (result: Result)
  isUserSubscribed(args: Args) returns (result: Result)
  health(args: Args) returns (result: Result)
  checkInfrastructureHealth(args: Args) returns (result: Result)
  setupGPU(args: Args) returns (result: Result)
  checkGPUStatus(args: Args) returns (result: Result)
  updateTraefikPorts(args: Args) returns (result: Result)
  getTraefikPorts(args: Args) returns (result: Result)
  updateLogCleanup(args: Args) returns (result: Result)
  getLogCleanupStatus(args: Args) returns (result: Result)
  getHanzoCloudIps(args: Args) returns (result: Result)
}
