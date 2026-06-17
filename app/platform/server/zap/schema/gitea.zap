# gitea.zap — Gitea git-provider capability.
#
# Native ZAP schema replacing the tRPC `giteaRouter`
# (server/api/routers/gitea.ts). Two methods were
# `withPermission("gitProviders", "create")` (an authenticated caller whose
# body additionally records an audit side effect); the rest were
# `protectedProcedure` (authenticated caller). Inputs are Zod objects carried
# via the shared Args struct (../args.ts); return values via the shared Result
# struct (../result.ts). This schema declares only the method ordinals — the
# request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/gitea.zap -out schema/`.

package gitea

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Gitea {
  create(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  giteaProviders(args: Args) returns (result: Result)
  getGiteaRepositories(args: Args) returns (result: Result)
  getGiteaBranches(args: Args) returns (result: Result)
  testConnection(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  getGiteaUrl(args: Args) returns (result: Result)
}
