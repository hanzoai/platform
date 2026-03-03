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
import { PLANS } from "@hanzo/platform/billing/pricing";
import { findUserById } from "@hanzo/platform";

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
    .input(z.object({ plan: z.enum(["hobby", "pro"]) }))
    .mutation(async ({ ctx, input }) => {
      const user = await findUserById(ctx.user.id);
      const wallet = await getOrganizationWallet(ctx.session.activeOrganizationId);

      return await createSubscription({
        organizationId: ctx.session.activeOrganizationId,
        ownerId: user.id,
        ownerEmail: user.email,
        plan: input.plan,
        stripeCustomerId: wallet?.stripeCustomerId,
      });
    }),

  addCredits: protectedProcedure
    .input(z.object({ amount: z.number().min(10) }))
    .mutation(async ({ ctx, input }) => {
      const wallet = await getOrganizationWallet(ctx.session.activeOrganizationId);
      if (!wallet?.stripeCustomerId) throw new Error("No subscription");

      return await createManualTopup({
        organizationId: ctx.session.activeOrganizationId,
        amount: input.amount,
        stripeCustomerId: wallet.stripeCustomerId,
      });
    }),

  getPlans: protectedProcedure.query(() => PLANS),

  createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
    return await createCustomerPortalSession(ctx.session.activeOrganizationId);
  }),
});
