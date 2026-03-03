// Payment Provider Abstraction
// Allows platform to work without any payment provider configured

import { createRequire } from "module";
const require = createRequire(import.meta.url);

export interface PaymentProvider {
  name: string;
  isConfigured: boolean;
  createSubscription(params: CreateSubscriptionParams): Promise<{ sessionId: string }>;
  createTopup(params: CreateTopupParams): Promise<{ sessionId: string }>;
  triggerAutoTopup(wallet: WalletInfo): Promise<void>;
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
  createCustomer(email: string, metadata: Record<string, string>): Promise<{ id: string }>;
}

export interface CreateSubscriptionParams {
  organizationId: string;
  ownerId: string;
  ownerEmail: string;
  plan: string;
  customerId?: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateTopupParams {
  organizationId: string;
  amount: number;
  customerId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface WalletInfo {
  organizationId: string;
  stripeCustomerId?: string;
  autoTopupAmount?: string;
  balance?: string;
}

// Null provider - does nothing, used when no payment provider is configured
class NullPaymentProvider implements PaymentProvider {
  name = "none";
  isConfigured = false;

  async createSubscription(): Promise<{ sessionId: string }> {
    throw new Error("Payment provider not configured");
  }

  async createTopup(): Promise<{ sessionId: string }> {
    throw new Error("Payment provider not configured");
  }

  async triggerAutoTopup(): Promise<void> {
    // No-op when not configured
  }

  async createPortalSession(): Promise<{ url: string }> {
    throw new Error("Payment provider not configured");
  }

  async createCustomer(): Promise<{ id: string }> {
    throw new Error("Payment provider not configured");
  }
}

// Stripe provider - uses Stripe when configured
class StripePaymentProvider implements PaymentProvider {
  name = "stripe";
  isConfigured = true;
  private stripe: any;

  constructor() {
    const Stripe = require("stripe").default;
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-09-30.acacia" });
  }

  async createSubscription(params: CreateSubscriptionParams): Promise<{ sessionId: string }> {
    let customerId = params.customerId;
    if (!customerId) {
      const customer = await this.createCustomer(params.ownerEmail, {
        organizationId: params.organizationId,
        ownerId: params.ownerId,
      });
      customerId = customer.id;
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: params.priceId, quantity: 1 }],
      metadata: { organizationId: params.organizationId, ownerId: params.ownerId, plan: params.plan },
      subscription_data: { metadata: { organizationId: params.organizationId, plan: params.plan } },
      payment_method_collection: "always",
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });

    return { sessionId: session.id };
  }

  async createTopup(params: CreateTopupParams): Promise<{ sessionId: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      customer: params.customerId,
      line_items: [{
        price_data: {
          currency: "usd",
          unit_amount: params.amount * 100,
          product_data: { name: "Hanzo Platform Credits", description: `Add $${params.amount}` },
        },
        quantity: 1,
      }],
      metadata: { organizationId: params.organizationId, type: "manual_topup" },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });

    return { sessionId: session.id };
  }

  async triggerAutoTopup(wallet: WalletInfo): Promise<void> {
    if (!wallet.stripeCustomerId || !wallet.autoTopupAmount) return;

    const amount = Number(wallet.autoTopupAmount);
    const customer = await this.stripe.customers.retrieve(wallet.stripeCustomerId);
    if (customer.deleted) return;

    const defaultPaymentMethod = customer.invoice_settings?.default_payment_method;
    if (!defaultPaymentMethod) return;

    await this.stripe.paymentIntents.create({
      amount: amount * 100,
      currency: "usd",
      customer: wallet.stripeCustomerId,
      payment_method: defaultPaymentMethod as string,
      off_session: true,
      confirm: true,
      metadata: { organizationId: wallet.organizationId, type: "auto_topup" },
    });
  }

  async createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }

  async createCustomer(email: string, metadata: Record<string, string>): Promise<{ id: string }> {
    const customer = await this.stripe.customers.create({ email, metadata });
    return { id: customer.id };
  }
}

// Factory to get the appropriate payment provider
let _provider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (!_provider) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (stripeKey && stripeKey !== "CHANGE_ME") {
      _provider = new StripePaymentProvider();
    } else {
      _provider = new NullPaymentProvider();
    }
  }
  return _provider;
}

export function isPaymentConfigured(): boolean {
  return getPaymentProvider().isConfigured;
}
