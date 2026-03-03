import Stripe from "stripe";
import { addCreditsToWallet, getOrganizationWallet } from "./wallet-service";
import { PLANS, type PlanType } from "./pricing";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-09-30.acacia" });

const WEBSITE_URL = process.env.NODE_ENV === "development" ? "http://localhost:3000" : process.env.SITE_URL;

export const STRIPE_PRODUCTS = {
  hobby: { priceId: process.env.STRIPE_HOBBY_PRICE_ID || "", amount: 20 },
  pro: { priceId: process.env.STRIPE_PRO_PRICE_ID || "", amount: 200 },
};

export async function createSubscription(params: {
  organizationId: string;
  ownerId: string;
  ownerEmail: string;
  plan: PlanType;
  stripeCustomerId?: string;
}) {
  const product = STRIPE_PRODUCTS[params.plan as "hobby" | "pro"];

  let customerId = params.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: params.ownerEmail,
      metadata: { organizationId: params.organizationId, ownerId: params.ownerId },
    });
    customerId = customer.id;
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: product.priceId, quantity: 1 }],
    metadata: { organizationId: params.organizationId, ownerId: params.ownerId, plan: params.plan },
    subscription_data: { metadata: { organizationId: params.organizationId, plan: params.plan } },
    payment_method_collection: "always",
    success_url: `${WEBSITE_URL}/dashboard/billing?success=true`,
    cancel_url: `${WEBSITE_URL}/dashboard/billing?canceled=true`,
  });

  return { sessionId: session.id };
}

export async function createManualTopup(params: { organizationId: string; amount: number; stripeCustomerId: string }) {
  if (params.amount < 10) throw new Error("Minimum top-up is $10");

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: params.stripeCustomerId,
    line_items: [{
      price_data: {
        currency: "usd",
        unit_amount: params.amount * 100,
        product_data: { name: "Hanzo Platform Credits", description: `Add $${params.amount}` },
      },
      quantity: 1,
    }],
    metadata: { organizationId: params.organizationId, type: "manual_topup" },
    success_url: `${WEBSITE_URL}/dashboard/billing?topup=success`,
    cancel_url: `${WEBSITE_URL}/dashboard/billing`,
  });

  return { sessionId: session.id };
}

export async function triggerAutoTopupPayment(wallet: any) {
  if (!wallet.stripeCustomerId || !wallet.autoTopupAmount) return;

  const amount = Number(wallet.autoTopupAmount);
  const customer = await stripe.customers.retrieve(wallet.stripeCustomerId);
  if (customer.deleted || !customer.invoice_settings?.default_payment_method) return;

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amount * 100,
    currency: "usd",
    customer: wallet.stripeCustomerId,
    payment_method: customer.invoice_settings.default_payment_method as string,
    off_session: true,
    confirm: true,
    metadata: { organizationId: wallet.organizationId, type: "auto_topup" },
  });

  if (paymentIntent.status === "succeeded") {
    await addCreditsToWallet(wallet.organizationId, amount, "auto_topup", `Auto top-up at $${wallet.balance}`, paymentIntent.id);
  }
}

export async function createCustomerPortalSession(organizationId: string) {
  const wallet = await getOrganizationWallet(organizationId);
  if (!wallet?.stripeCustomerId) throw new Error("No Stripe customer");

  const session = await stripe.billingPortal.sessions.create({
    customer: wallet.stripeCustomerId,
    return_url: `${WEBSITE_URL}/dashboard/billing`,
  });

  return { url: session.url };
}

export { stripe };
