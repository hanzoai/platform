# github.zap — git (GitHub) provider capability.
#
# Native ZAP schema replacing the tRPC `githubRouter`
# (server/api/routers/github.ts). Every read method was a `protectedProcedure`
# (authenticated caller); `update` was `withPermission("gitProviders", "create")`
# whose body is likewise just an authenticated caller (no extra in-body check).
# Inputs are Zod objects carried via the shared Args struct (../args.ts); return
# values via the shared Result struct (../result.ts). This schema declares only
# the method ordinals — the request/response payloads ride the generic carriers.
# Compiled by `zapgen schema/github.zap -out schema/`.

package github

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Github {
  one(args: Args) returns (result: Result)
  getGithubRepositories(args: Args) returns (result: Result)
  getGithubBranches(args: Args) returns (result: Result)
  githubProviders(args: Args) returns (result: Result)
  testConnection(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
}
