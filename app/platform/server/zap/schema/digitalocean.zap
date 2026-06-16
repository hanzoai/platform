# digitalocean.zap — DigitalOcean cloud-provider capability.
#
# Native ZAP schema replacing the tRPC `digitaloceanRouter`
# (server/api/routers/digitalocean.ts). Every method was `protectedProcedure`
# whose body additionally enforces per-provider / per-pool / per-instance org
# ownership (verbatim in dispatch). Inputs are Zod objects carried via the
# shared Args struct (../args.ts); return values via the shared Result struct
# (../result.ts). This schema declares only the method ordinals — the
# request/response payloads ride the generic carriers. The tRPC
# `onNodeStatusChange` subscription had no client consumer and no ZAP transport
# equivalent, so it is dropped (the UI polls listPoolInstances directly).
# Compiled by `zapgen schema/digitalocean.zap -out schema/`.

package digitalocean

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface DigitalOcean {
  configureProvider(args: Args) returns (result: Result)
  updateProvider(args: Args) returns (result: Result)
  listProviders(args: Args) returns (result: Result)
  getProvider(args: Args) returns (result: Result)
  deleteProvider(args: Args) returns (result: Result)
  listSizes(args: Args) returns (result: Result)
  listRegions(args: Args) returns (result: Result)
  scaleUp(args: Args) returns (result: Result)
  scaleDown(args: Args) returns (result: Result)
  resizeInstance(args: Args) returns (result: Result)
  drainNode(args: Args) returns (result: Result)
  removeInstance(args: Args) returns (result: Result)
  listPoolInstances(args: Args) returns (result: Result)
  getScalingStatus(args: Args) returns (result: Result)
  listScalingJobs(args: Args) returns (result: Result)
  createFirewall(args: Args) returns (result: Result)
  createLoadBalancer(args: Args) returns (result: Result)
  registerNode(args: Args) returns (result: Result)
  getSwarmJoinToken(args: Args) returns (result: Result)
}
