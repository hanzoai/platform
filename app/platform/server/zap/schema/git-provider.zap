# git-provider.zap — git-provider capability.
#
# Native ZAP schema replacing the tRPC `gitProviderRouter`
# (server/api/routers/git-provider.ts). `getAll`/`toggleShare` were
# `protectedProcedure`; `allForPermissions` was `withPermission("member",
# "update")` plus an enterprise-license gate; `remove` was
# `withPermission("gitProviders", "delete")` — authenticated callers whose
# bodies additionally enforce per-provider org ownership. Inputs are Zod objects
# carried via the shared Args struct (../args.ts); return values via the shared
# Result struct (../result.ts). This schema declares only the method ordinals —
# the request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/git-provider.zap -out schema/`.

package gitprovider

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface GitProvider {
  getAll(args: Args) returns (result: Result)
  toggleShare(args: Args) returns (result: Result)
  allForPermissions(args: Args) returns (result: Result)
  remove(args: Args) returns (result: Result)
}
