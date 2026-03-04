// Commerce billing service
// Delegates to the CommercePaymentProvider via the payment-provider abstraction.
// This file retains the same public API so existing callers (billing router) are unchanged.

import { getPaymentProvider, isPaymentConfigured } from "./payment-provider";
import { getOrganizationWallet } from "./wallet-service";
import { type PlanType, normalizePlanType, PLANS } from "./pricing";

const WEBSITE_URL = process.env.NODE_ENV === "development" ? "http://localhost:3000" : process.env.SITE_URL;

export async function createSubscription(params: {
  organizationId: string;
  ownerId: string;
  ownerEmail: string;
  plan: PlanType;
  stripeCustomerId?: string;
}) {
  const provider = getPaymentProvider();
  const normalized = normalizePlanType(params.plan);
  const planConfig = PLANS[normalized];

  return provider.createSubscription({
    organizationId: params.organizationId,
    ownerId: params.ownerId,
    ownerEmail: params.ownerEmail,
    plan: normalized,
    customerId: params.stripeCustomerId,
    priceId: normalized, // Commerce API resolves plan by name, not Stripe price ID
    successUrl: `${WEBSITE_URL}/dashboard/billing?success=true`,
    cancelUrl: `${WEBSITE_URL}/dashboard/billing?canceled=true`,
  });
}

export async function createManualTopup(params: { organizationId: string; amount: number; stripeCustomerId: string }) {
  if (params.amount < 10) throw new Error("Minimum top-up is $10");

  const provider = getPaymentProvider();
  return provider.createTopup({
    organizationId: params.organizationId,
    amount: params.amount,
    customerId: params.stripeCustomerId,
    successUrl: `${WEBSITE_URL}/dashboard/billing?topup=success`,
    cancelUrl: `${WEBSITE_URL}/dashboard/billing`,
  });
}

export async function triggerAutoTopupPayment(wallet: any) {
  if (!wallet.commerceCustomerId && !wallet.stripeCustomerId) return;
  if (!wallet.autoTopupAmount) return;

  const provider = getPaymentProvider();
  await provider.triggerAutoTopup({
    organizationId: wallet.organizationId,
    commerceCustomerId: wallet.commerceCustomerId || wallet.stripeCustomerId,
    autoTopupAmount: wallet.autoTopupAmount,
    balance: wallet.balance,
  });
}

export async function createCustomerPortalSession(organizationId: string) {
  const wallet = await getOrganizationWallet(organizationId);
  const customerId = wallet?.stripeCustomerId;
  if (!customerId) throw new Error("No payment customer");

  const provider = getPaymentProvider();
  return provider.createPortalSession(
    customerId,
    `${WEBSITE_URL}/dashboard/billing`
  );
}

export { isPaymentConfigured };
