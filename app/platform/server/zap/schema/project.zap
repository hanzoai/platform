# project.zap — Project capability.
#
# Native ZAP schema replacing the tRPC `projectRouter`
# (server/api/routers/project.ts). Methods are `protectedProcedure` except
# `allForPermissions` (`withPermission("member","update")`); the org-ownership
# and member-access checks ride verbatim inside dispatch (project-cap.ts). Inputs
# are Zod objects carried via the shared Args struct (../args.ts); return values
# via the shared Result struct (../result.ts). This schema declares only the
# method ordinals — the request/response payloads ride the generic carriers.
# Compiled by `zapgen schema/project.zap -out schema/`.

package project

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Project {
  create(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  all(args: Args) returns (result: Result)
  allForPermissions(args: Args) returns (result: Result)
  homeStats(args: Args) returns (result: Result)
  search(args: Args) returns (result: Result)
  remove(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  duplicate(args: Args) returns (result: Result)
}
