# gitlab.zap — GitLab git-provider capability.
#
# Native ZAP schema replacing the tRPC `gitlabRouter`
# (server/api/routers/gitlab.ts). `create`/`update` were
# `withPermission("gitProviders", "create")`; the rest were `protectedProcedure`
# — an authenticated caller whose body additionally enforces per-provider org
# ownership. Inputs are Zod objects carried via the shared Args struct
# (../args.ts); return values via the shared Result struct (../result.ts). This
# schema declares only the method ordinals — the request/response payloads ride
# the generic carriers. Compiled by `zapgen schema/gitlab.zap -out schema/`.

package gitlab

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Gitlab {
  create(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  gitlabProviders(args: Args) returns (result: Result)
  getGitlabRepositories(args: Args) returns (result: Result)
  getGitlabBranches(args: Args) returns (result: Result)
  testConnection(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
}
