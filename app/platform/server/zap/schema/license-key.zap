# license-key.zap — enterprise license-key capability.
#
# Native ZAP schema replacing the tRPC `licenseKeyRouter`
# (server/api/routers/proprietary/license-key.ts). Five methods were
# `adminProcedure` (the WS admin gate, owner|admin); one
# (`haveValidLicenseKey`) was `protectedProcedure` (session+user only). The
# admin methods' bodies additionally enforce `ctx.user.role === "owner"`
# verbatim inside dispatch. Inputs are Zod objects carried via the shared Args
# struct (../args.ts); return values via the shared Result struct
# (../result.ts). This schema declares only the method ordinals — the
# request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/license-key.zap -out schema/`.

package licensekey

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface LicenseKey {
  activate(args: Args) returns (result: Result)
  validate(args: Args) returns (result: Result)
  deactivate(args: Args) returns (result: Result)
  getEnterpriseSettings(args: Args) returns (result: Result)
  haveValidLicenseKey(args: Args) returns (result: Result)
  updateEnterpriseSettings(args: Args) returns (result: Result)
}
