# admin.zap — admin capability.
#
# Native ZAP schema replacing the tRPC `adminRouter`
# (server/api/routers/admin.ts). The sole method was an `adminProcedure`
# (owner|admin only) whose body sets up web-server monitoring. Inputs are
# carried via the shared Args struct (../args.ts); return values via the
# shared Result struct (../result.ts). This schema declares only the method
# ordinals — the request/response payloads ride the generic carriers.
# Compiled by `zapgen schema/admin.zap -out schema/`.

package admin

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Admin {
  setupMonitoring(args: Args) returns (result: Result)
}
