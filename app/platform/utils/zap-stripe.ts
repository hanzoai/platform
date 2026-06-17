/**
 * utils/zap-stripe.ts — native ZAP RPC client (browser) for the Stripe
 * (billing) capability. Replaces the tRPC `api.stripe.*` surface.
 *
 * Opens a single WebSocket to `/zap/stripe` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated StripeMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { StripeMethod } from "@/server/zap/schema/stripe_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/stripe");

// Every Stripe method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const getCurrentPlan = rpc.query(
	StripeMethod.getCurrentPlan,
	"getCurrentPlan",
	args,
);
const getProducts = rpc.query(StripeMethod.getProducts, "getProducts", args);
const canCreateMoreServers = rpc.query(
	StripeMethod.canCreateMoreServers,
	"canCreateMoreServers",
	args,
);
const getInvoices = rpc.query(StripeMethod.getInvoices, "getInvoices", args);

export const stripe = {
	getCurrentPlan,
	getProducts,
	createCheckoutSession: rpc.mutation(StripeMethod.createCheckoutSession, args),
	createCustomerPortalSession: rpc.mutation(
		StripeMethod.createCustomerPortalSession,
		args,
	),
	upgradeSubscription: rpc.mutation(StripeMethod.upgradeSubscription, args),
	canCreateMoreServers,
	getInvoices,
	useUtils: makeUseUtils({
		getCurrentPlan,
		getProducts,
		canCreateMoreServers,
		getInvoices,
	}),
} as const;
