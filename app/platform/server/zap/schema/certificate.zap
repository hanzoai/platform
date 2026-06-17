# certificate.zap — TLS certificate capability.
#
# Native ZAP schema replacing the tRPC `certificateRouter`
# (server/api/routers/certificate.ts). Every method was
# `withPermission("certificate", <action>)` — an authenticated caller whose body
# additionally enforces per-certificate org ownership. Inputs are Zod objects
# carried via the shared Args struct (../args.ts); return values via the shared
# Result struct (../result.ts). This schema declares only the method ordinals —
# the request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/certificate.zap -out schema/`.

package certificate

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Certificate {
  create(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  remove(args: Args) returns (result: Result)
  all(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
}
