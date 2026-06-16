# bitbucket.zap — Bitbucket git-provider capability.
#
# Native ZAP schema replacing the tRPC `bitbucketRouter`
# (server/api/routers/bitbucket.ts). Methods mix `withPermission("gitProviders",
# "create")` (create, update) and bare `protectedProcedure` (one,
# bitbucketProviders, getBitbucketRepositories, getBitbucketBranches,
# testConnection) — an authenticated caller whose body additionally enforces
# per-provider org ownership. Inputs are Zod objects carried via the shared Args
# struct (../args.ts); return values via the shared Result struct (../result.ts).
# This schema declares only the method ordinals — the request/response payloads
# ride the generic carriers. Compiled by `zapgen schema/bitbucket.zap -out schema/`.

package bitbucket

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Bitbucket {
  create(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  bitbucketProviders(args: Args) returns (result: Result)
  getBitbucketRepositories(args: Args) returns (result: Result)
  getBitbucketBranches(args: Args) returns (result: Result)
  testConnection(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
}
