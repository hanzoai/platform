# user.zap — user capability.
#
# Native ZAP schema replacing the tRPC `userRouter`
# (server/api/routers/user.ts). Methods mix publicProcedure,
# protectedProcedure, adminProcedure, and withPermission(...) bases — every
# authenticated caller is established at the mint boundary (session+user), and
# each body's additional org/role/permission checks ride verbatim inside
# dispatch. Inputs are Zod objects carried via the shared Args struct
# (../args.ts); return values via the shared Result struct (../result.ts). This
# schema declares only the method ordinals — the request/response payloads ride
# the generic carriers. Compiled by `zapgen schema/user.zap -out schema/`.

package user

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface User {
  all(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  session(args: Args) returns (result: Result)
  get(args: Args) returns (result: Result)
  getPermissions(args: Args) returns (result: Result)
  haveRootAccess(args: Args) returns (result: Result)
  getBackups(args: Args) returns (result: Result)
  getServerMetrics(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  getUserByToken(args: Args) returns (result: Result)
  getMetricsToken(args: Args) returns (result: Result)
  remove(args: Args) returns (result: Result)
  assignPermissions(args: Args) returns (result: Result)
  getInvitations(args: Args) returns (result: Result)
  getContainerMetrics(args: Args) returns (result: Result)
  generateToken(args: Args) returns (result: Result)
  deleteApiKey(args: Args) returns (result: Result)
  createApiKey(args: Args) returns (result: Result)
  checkUserOrganizations(args: Args) returns (result: Result)
  createUserWithCredentials(args: Args) returns (result: Result)
  sendInvitation(args: Args) returns (result: Result)
  getBookmarkedTemplates(args: Args) returns (result: Result)
  toggleTemplateBookmark(args: Args) returns (result: Result)
}
