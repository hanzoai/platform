# docker.zap — Docker container capability.
#
# Native ZAP schema replacing the tRPC `dockerRouter`
# (server/api/routers/docker.ts). Every method was
# `withPermission("docker"|"service", <action>)` — an authenticated caller whose
# body additionally enforces per-server org ownership. Inputs are Zod objects
# carried via the shared Args struct (../args.ts); return values via the shared
# Result struct (../result.ts). This schema declares only the method ordinals —
# the request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/docker.zap -out schema/`.

package docker

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Docker {
  getContainers(args: Args) returns (result: Result)
  restartContainer(args: Args) returns (result: Result)
  startContainer(args: Args) returns (result: Result)
  stopContainer(args: Args) returns (result: Result)
  killContainer(args: Args) returns (result: Result)
  removeContainer(args: Args) returns (result: Result)
  getConfig(args: Args) returns (result: Result)
  getContainersByAppNameMatch(args: Args) returns (result: Result)
  getContainersByAppLabel(args: Args) returns (result: Result)
  getStackContainersByAppName(args: Args) returns (result: Result)
  getServiceContainersByAppName(args: Args) returns (result: Result)
  uploadFileToContainer(args: Args) returns (result: Result)
}
