# patch.zap — patch capability.
#
# Native ZAP schema replacing the tRPC `patchRouter`
# (server/api/routers/patch.ts). Every method was a `protectedProcedure`
# (authenticated caller, session+user) whose body additionally enforces
# per-service permission via checkServicePermissionAndAccess — except
# `cleanPatchRepos`, which was an `adminProcedure` (owner|admin only), gated
# per-call inside dispatch. Inputs are Zod objects carried via the shared Args
# struct (../args.ts); return values via the shared Result struct (../result.ts).
# This schema declares only the method ordinals — the request/response payloads
# ride the generic carriers. Compiled by `zapgen schema/patch.zap -out schema/`.

package patch

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Patch {
  create(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  byEntityId(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  delete(args: Args) returns (result: Result)
  toggleEnabled(args: Args) returns (result: Result)
  ensureRepo(args: Args) returns (result: Result)
  readRepoDirectories(args: Args) returns (result: Result)
  readRepoFile(args: Args) returns (result: Result)
  saveFileAsPatch(args: Args) returns (result: Result)
  markFileForDeletion(args: Args) returns (result: Result)
  cleanPatchRepos(args: Args) returns (result: Result)
}
