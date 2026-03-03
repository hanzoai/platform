import { createTRPCRouter, protectedProcedure } from "../trpc";
import { z } from "zod";
import {
  getOrganizationWallet,
  getWalletBalance,
  createOrganizationWallet,
  addCreditsToWallet,
} from "@hanzo/platform/billing/wallet-service";
import {
  createSubscription,
  createManualTopup,
  createCustomerPortalSession,
} from "@hanzo/platform/billing/stripe-service";
import { getPlans, normalizePlanType } from "@hanzo/platform/billing/pricing";
import type { PlanType } from "@hanzo/platform/billing/pricing";
import { findUserById } from "@hanzo/platform";

// Accept canonical + legacy plan names for backward compat.
const planEnum = z.enum(["developer", "pro", "team", "enterprise", "hobby"]);

export const billingRouter = createTRPCRouter({
  getWallet: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await getOrganizationWallet(ctx.session.activeOrganizationId);
    } catch {
      return null;
    }
  }),

  getBalance: protectedProcedure.query(async ({ ctx }) => {
    try {
      const balance = await getWalletBalance(ctx.session.activeOrganizationId);
      return { balance };
    } catch {
      return { balance: 0 };
    }
  }),

  createSubscription: protectedProcedure
    .input(z.object({ plan: planEnum }))
    .mutation(async ({ ctx, input }) => {
      const user = await findUserById(ctx.user.id);
      const wallet = await getOrganizationWallet(ctx.session.activeOrganizationId);

      // Normalize legacy "hobby" -> "developer" before passing downstream.
      const plan = normalizePlanType(input.plan) as PlanType;

      return await createSubscription({
        organizationId: ctx.session.activeOrganizationId,
        ownerId: user.id,
        ownerEmail: user.email,
        plan,
        stripeCustomerId: wallet?.stripeCustomerId ?? wallet?.organizationId ?? undefined,
      });
    }),

  addCredits: protectedProcedure
    .input(z.object({ amount: z.number().min(10) }))
    .mutation(async ({ ctx, input }) => {
      const wallet = await getOrganizationWallet(ctx.session.activeOrganizationId);
      const customerId = wallet?.stripeCustomerId || wallet?.organizationId;
      if (!customerId) throw new Error("No subscription");

      return await createManualTopup({
        organizationId: ctx.session.activeOrganizationId,
        amount: input.amount,
        stripeCustomerId: customerId,
      });
    }),

  getPlans: protectedProcedure.query(async () => {
    return await getPlans();
  }),

  createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
    return await createCustomerPortalSession(ctx.session.activeOrganizationId);
  }),
});
