# visor.zap — cloud instance management capability.
#
# Native ZAP schema replacing the tRPC `visorRouter`
# (server/api/routers/visor.ts). Every method was a `protectedProcedure`
# (authenticated caller, session+user) that forwards the user's IAM bearer
# token to the Visor service, scoped by the session's activeOrganizationId.
# Inputs are Zod objects carried via the shared Args struct (../args.ts);
# return values via the shared Result struct (../result.ts). This schema
# declares only the method ordinals — the request/response payloads ride the
# generic carriers. Compiled by `zapgen schema/visor.zap -out schema/`.

package visor

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Visor {
  listMachines(args: Args) returns (result: Result)
  getMachine(args: Args) returns (result: Result)
  createMachine(args: Args) returns (result: Result)
  updateMachine(args: Args) returns (result: Result)
  deleteMachine(args: Args) returns (result: Result)
  listProviders(args: Args) returns (result: Result)
  listPlans(args: Args) returns (result: Result)
  listNodePools(args: Args) returns (result: Result)
  listVolumes(args: Args) returns (result: Result)
  createVolume(args: Args) returns (result: Result)
  deleteVolume(args: Args) returns (result: Result)
}
