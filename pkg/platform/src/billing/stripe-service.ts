import { getPaymentProvider, isPaymentConfigured } from "./payment-provider";
import { addCreditsToWallet, getOrganizationWallet } from "./wallet-service";
import { type PlanType, normalizePlanType } from "./pricing";

const WEBSITE_URL = process.env.NODE_ENV === "development" ? "http://localhost:3000" : process.env.SITE_URL;

export const STRIPE_PRODUCTS: Record<PlanType, { priceId: string; amount: number }> = {
  developer: { priceId: process.env.STRIPE_DEVELOPER_PRICE_ID || "", amount: 0 },
  pro: { priceId: process.env.STRIPE_PRO_PRICE_ID || "", amount: 49 },
  team: { priceId: process.env.STRIPE_TEAM_PRICE_ID || "", amount: 199 },
  enterprise: { priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID || "", amount: 0 },
};

// Backward-compat: resolve legacy plan names before looking up Stripe product.
function resolveStripeProduct(plan: string) {
  const normalized = normalizePlanType(plan);
  return STRIPE_PRODUCTS[normalized];
}

export async function createSubscription(params: {
  organizationId: string;
  ownerId: string;
  ownerEmail: string;
  plan: PlanType;
  stripeCustomerId?: string;
}) {
  const provider = getPaymentProvider();
  const product = resolveStripeProduct(params.plan);

  return provider.createSubscription({
    organizationId: params.organizationId,
    ownerId: params.ownerId,
    ownerEmail: params.ownerEmail,
    plan: params.plan,
    customerId: params.stripeCustomerId,
    priceId: product.priceId,
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
  if (!wallet.stripeCustomerId || !wallet.autoTopupAmount) return;

  const provider = getPaymentProvider();
  await provider.triggerAutoTopup({
    organizationId: wallet.organizationId,
    stripeCustomerId: wallet.stripeCustomerId,
    autoTopupAmount: wallet.autoTopupAmount,
    balance: wallet.balance,
  });

  // Note: Credit addition is handled in the payment provider webhook
}

export async function createCustomerPortalSession(organizationId: string) {
  const wallet = await getOrganizationWallet(organizationId);
  if (!wallet?.stripeCustomerId) throw new Error("No payment customer");

  const provider = getPaymentProvider();
  return provider.createPortalSession(
    wallet.stripeCustomerId,
    `${WEBSITE_URL}/dashboard/billing`
  );
}

export { isPaymentConfigured };
