# billing.zap — billing capability.
#
# Native ZAP schema replacing the tRPC `billingRouter`
# (server/api/routers/billing.ts). Every method was a `protectedProcedure` — an
# authenticated caller (session+user) whose body operates on its active
# organization. Inputs are Zod objects carried via the shared Args struct
# (../args.ts); return values via the shared Result struct (../result.ts). This
# schema declares only the method ordinals — the request/response payloads ride
# the generic carriers. Compiled by `zapgen schema/billing.zap -out schema/`.

package billing

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Billing {
  getWallet(args: Args) returns (result: Result)
  getBalance(args: Args) returns (result: Result)
  createSubscription(args: Args) returns (result: Result)
  addCredits(args: Args) returns (result: Result)
  getPlans(args: Args) returns (result: Result)
  createPortalSession(args: Args) returns (result: Result)
}
