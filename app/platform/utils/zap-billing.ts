/**
 * utils/zap-billing.ts — native ZAP RPC client (browser) for the Billing
 * capability. Replaces the tRPC `api.billing.*` surface.
 *
 * Opens a single WebSocket to `/zap/billing` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated BillingMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { BillingMethod } from "@/server/zap/schema/billing_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/billing");

// Every Billing method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const getWallet = rpc.query(BillingMethod.getWallet, "getWallet", args);
const getBalance = rpc.query(BillingMethod.getBalance, "getBalance", args);
const getPlans = rpc.query(BillingMethod.getPlans, "getPlans", args);

export const billing = {
	getWallet,
	getBalance,
	createSubscription: rpc.mutation(BillingMethod.createSubscription, args),
	addCredits: rpc.mutation(BillingMethod.addCredits, args),
	getPlans,
	createPortalSession: rpc.mutation(BillingMethod.createPortalSession, args),
	useUtils: makeUseUtils({ getWallet, getBalance, getPlans }),
} as const;
