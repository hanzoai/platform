# organization.zap — Organization capability.
#
# Native ZAP schema replacing the tRPC `organizationRouter`
# (server/api/routers/organization.ts). Methods are `protectedProcedure` except
# `allInvitations`/`removeInvitation` (`adminProcedure`); the owner/membership
# checks ride verbatim inside dispatch (organization-cap.ts). Inputs are Zod
# objects carried via the shared Args struct (../args.ts); return values via the
# shared Result struct (../result.ts). This schema declares only the method
# ordinals — the request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/organization.zap -out schema/`.

package organization

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Organization {
  create(args: Args) returns (result: Result)
  all(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  delete(args: Args) returns (result: Result)
  allInvitations(args: Args) returns (result: Result)
  removeInvitation(args: Args) returns (result: Result)
}
