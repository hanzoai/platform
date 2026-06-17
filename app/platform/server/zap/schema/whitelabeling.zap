# whitelabeling.zap — white-label settings capability.
#
# Native ZAP schema replacing the tRPC `whitelabelingRouter`
# (server/api/routers/proprietary/whitelabeling.ts). The router mixes procedure
# bases: `protectedProcedure` (get), `enterpriseProcedure` (update, reset —
# owner-only inside the body) and `publicProcedure` (getPublic — no auth).
# Inputs ride the shared Args carrier (../args.ts); return values the shared
# Result carrier (../result.ts). Compiled by
# `zapgen schema/whitelabeling.zap -out schema/`.

package whitelabeling

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).

interface Whitelabeling {
  get(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  reset(args: Args) returns (result: Result)
  getPublic(args: Args) returns (result: Result)
}
