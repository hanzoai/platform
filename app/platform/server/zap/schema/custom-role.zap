# custom-role.zap — custom organization-role capability (PROPRIETARY).
#
# Native ZAP schema replacing the tRPC `customRoleRouter`
# (server/api/routers/proprietary/custom-role.ts). Each method maps one
# procedure: `all`, `membersByRole`, and `getStatements` were
# `protectedProcedure` (authenticated); `create`, `update`, and `remove` were
# `enterpriseProcedure` (= adminProcedure, owner|admin only) — gated per-call
# in dispatch. Inputs are Zod objects carried via the shared Args struct
# (../args.ts); return values via the shared Result struct (../result.ts). This
# schema declares only the method ordinals — the request/response payloads ride
# the generic carriers. Compiled by `zapgen schema/custom-role.zap -out schema/`.

package customrole

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface CustomRole {
  all(args: Args) returns (result: Result)
  create(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  remove(args: Args) returns (result: Result)
  membersByRole(args: Args) returns (result: Result)
  getStatements(args: Args) returns (result: Result)
}
