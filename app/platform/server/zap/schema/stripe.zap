# stripe.zap — billing (Stripe/Commerce) capability.
#
# Native ZAP schema replacing the tRPC `stripeRouter`
# (server/api/routers/stripe.ts). `getCurrentPlan` was a `protectedProcedure`;
# every other method was an `adminProcedure` (owner|admin only), gated per-call
# in dispatch. Inputs are Zod objects carried via the shared Args struct
# (../args.ts); return values via the shared Result struct (../result.ts). This
# schema declares only the method ordinals — the request/response payloads ride
# the generic carriers. Compiled by `zapgen schema/stripe.zap -out schema/`.

package stripe

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Stripe {
  getCurrentPlan(args: Args) returns (result: Result)
  getProducts(args: Args) returns (result: Result)
  createCheckoutSession(args: Args) returns (result: Result)
  createCustomerPortalSession(args: Args) returns (result: Result)
  upgradeSubscription(args: Args) returns (result: Result)
  canCreateMoreServers(args: Args) returns (result: Result)
  getInvoices(args: Args) returns (result: Result)
}
