# sso.zap — enterprise SSO capability.
#
# Native ZAP schema replacing the tRPC `ssoRouter`
# (server/api/routers/enterprise/sso.ts). The router mixes procedure bases:
# `publicProcedure` (showSignInWithSSO, enforceSSO — no auth) and
# `enterpriseProcedure` (the rest — owner|admin gated). Inputs ride the shared
# Args carrier (../args.ts); return values the shared Result carrier
# (../result.ts). This schema declares only the method ordinals — the
# request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/sso.zap -out schema/`.

package sso

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).

interface Sso {
  showSignInWithSSO(args: Args) returns (result: Result)
  enforceSSO(args: Args) returns (result: Result)
  listProviders(args: Args) returns (result: Result)
  getTrustedOrigins(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  deleteProvider(args: Args) returns (result: Result)
  register(args: Args) returns (result: Result)
  addTrustedOrigin(args: Args) returns (result: Result)
  removeTrustedOrigin(args: Args) returns (result: Result)
  updateTrustedOrigin(args: Args) returns (result: Result)
}
