# deploy-provider.zap — deploy-provider capability.
#
# Native ZAP schema replacing the tRPC `deployProviderRouter`
# (server/api/routers/deploy-provider.ts). `create`/`update`/`remove` were
# `adminProcedure`; `one`/`all`/`testConnection` were `protectedProcedure` —
# an authenticated caller whose body additionally enforces per-provider org
# ownership inside the service functions. Inputs are Zod objects carried via the
# shared Args struct (../args.ts); return values via the shared Result struct
# (../result.ts). This schema declares only the method ordinals — the
# request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/deploy-provider.zap -out schema/`.

package deployprovider

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface DeployProvider {
  create(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  all(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  remove(args: Args) returns (result: Result)
  testConnection(args: Args) returns (result: Result)
}
