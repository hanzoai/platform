# mount.zap — volume/mount capability.
#
# Native ZAP schema replacing the tRPC `mountRouter`
# (server/api/routers/mount.ts). Every method was a `protectedProcedure` — an
# authenticated caller whose body additionally enforces per-mount/per-service
# org ownership. Inputs are Zod objects carried via the shared Args struct
# (../args.ts); return values via the shared Result struct (../result.ts). This
# schema declares only the method ordinals — the request/response payloads ride
# the generic carriers. Compiled by `zapgen schema/mount.zap -out schema/`.

package mount

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Mount {
  create(args: Args) returns (result: Result)
  remove(args: Args) returns (result: Result)
  one(args: Args) returns (result: Result)
  update(args: Args) returns (result: Result)
  allNamedByApplicationId(args: Args) returns (result: Result)
  listByServiceId(args: Args) returns (result: Result)
}
