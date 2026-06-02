// Payment Provider Abstraction
// Delegates to Commerce API at billing.hanzo.ai

const COMMERCE_API_URL = process.env.COMMERCE_API_URL || "https://billing.hanzo.ai";
const COMMERCE_SERVICE_TOKEN = process.env.COMMERCE_SERVICE_TOKEN || "";

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
  commerceCustomerId?: string;
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

async function commerceFetch(path: string, body: Record<string, unknown>): Promise<any> {
  const url = `${COMMERCE_API_URL}/api/v1/billing${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(COMMERCE_SERVICE_TOKEN ? { Authorization: `Bearer ${COMMERCE_SERVICE_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Commerce API ${path} returned ${res.status}: ${text}`);
  }

  return res.json();
}

async function commerceGet(path: string): Promise<any> {
  const url = `${COMMERCE_API_URL}/api/v1/billing${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(COMMERCE_SERVICE_TOKEN ? { Authorization: `Bearer ${COMMERCE_SERVICE_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Commerce API ${path} returned ${res.status}: ${text}`);
  }

  return res.json();
}

// Commerce API provider - delegates to billing.hanzo.ai
class CommercePaymentProvider implements PaymentProvider {
  name = "commerce";
  isConfigured = true;

  async createSubscription(params: CreateSubscriptionParams): Promise<{ sessionId: string }> {
    let customerId = params.customerId;
    if (!customerId) {
      const customer = await this.createCustomer(params.ownerEmail, {
        organizationId: params.organizationId,
        ownerId: params.ownerId,
      });
      customerId = customer.id;
    }

    const result = await commerceFetch("/subscriptions", {
      customerId,
      organizationId: params.organizationId,
      ownerId: params.ownerId,
      plan: params.plan,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
    });

    return { sessionId: result.sessionId || result.id };
  }

  async createTopup(params: CreateTopupParams): Promise<{ sessionId: string }> {
    const result = await commerceFetch("/topup", {
      customerId: params.customerId,
      organizationId: params.organizationId,
      amount: params.amount,
      currency: "usd",
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
    });

    return { sessionId: result.sessionId || result.id };
  }

  async triggerAutoTopup(wallet: WalletInfo): Promise<void> {
    if (!wallet.commerceCustomerId || !wallet.autoTopupAmount) return;

    await commerceFetch("/topup", {
      customerId: wallet.commerceCustomerId,
      organizationId: wallet.organizationId,
      amount: Number(wallet.autoTopupAmount),
      currency: "usd",
      autoTopup: true,
    });
  }

  async createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }> {
    const result = await commerceFetch("/portal-session", {
      customerId,
      returnUrl,
    });
    return { url: result.url };
  }

  async createCustomer(email: string, metadata: Record<string, string>): Promise<{ id: string }> {
    const result = await commerceFetch("/customers", { email, metadata });
    return { id: result.id || result.customerId };
  }
}

// Factory to get the appropriate payment provider
let _provider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (!_provider) {
    const token = process.env.COMMERCE_SERVICE_TOKEN;
    const apiUrl = process.env.COMMERCE_API_URL;
    if (token || apiUrl) {
      _provider = new CommercePaymentProvider();
    } else {
      _provider = new NullPaymentProvider();
    }
  }
  return _provider;
}

export function isPaymentConfigured(): boolean {
  return getPaymentProvider().isConfigured;
}
