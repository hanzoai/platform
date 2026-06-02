import { buffer } from "node:stream/consumers";
import { db } from "@/server/db";
import { organizationWallet } from "@/server/db/schema";
import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { createOrganizationWallet, addCreditsToWallet } from "@hanzo/platform/billing/wallet-service";
import { PLANS, normalizePlanType } from "@hanzo/platform/billing/pricing";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-09-30.acacia" });

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const buf = await buffer(req);
  const sig = req.headers["stripe-signature"] as string;

  try {
    const event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET!);
    console.log(`[Stripe Webhook] ${event.type}`);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const { organizationId, ownerId, plan } = session.metadata || {};
        if (!organizationId) break;

        if (session.mode === "subscription" && plan) {
          // normalizePlanType handles legacy "hobby" -> "developer"
          const wallet = await createOrganizationWallet(organizationId, ownerId!, plan);
          await db.update(organizationWallet)
            .set({ stripeCustomerId: session.customer as string, stripeSubscriptionId: session.subscription as string } as any)
            .where(eq(organizationWallet.organizationId, organizationId));
        }

        if (session.mode === "payment" && session.metadata?.type === "manual_topup") {
          await addCreditsToWallet(organizationId, session.amount_total! / 100, "manual_topup", "Manual top-up", session.payment_intent as string);
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;

        const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
        const { organizationId, plan } = subscription.metadata;
        if (!organizationId || !plan) break;

        const normalizedPlan = normalizePlanType(plan);
        const planConfig = PLANS[normalizedPlan];
        await addCreditsToWallet(organizationId, planConfig.monthlyCredits, "monthly_credit", `Monthly ${normalizedPlan} credits`);
        break;
      }

      case "payment_intent.succeeded": {
        const intent = event.data.object as Stripe.PaymentIntent;
        if (intent.metadata.type === "auto_topup" && intent.metadata.organizationId) {
          await addCreditsToWallet(intent.metadata.organizationId, intent.amount / 100, "auto_topup", "Auto top-up", intent.id);
        }
        break;
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("[Stripe Webhook] Error:", error);
    return res.status(400).send("Webhook error");
  }
}
