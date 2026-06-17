# schedule.zap — schedule capability.
#
# Native ZAP schema replacing the tRPC `scheduleRouter`
# (server/api/routers/schedule.ts). Every method was a `protectedProcedure`
# (authenticated caller, session+user) whose body additionally enforces
# per-schedule org ownership via assertScheduleOrgAccess. Inputs are Zod objects
# carried via the shared Args struct (../args.ts); return values via the shared
# Result struct (../result.ts). This schema declares only the method ordinals —
# the request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/schedule.zap -out schema/`.

package schedule

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Schedule {
  create(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  delete(args: Args) returns (result: Result)
  list(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  runManually(args: Args) returns (result: Result)
}
