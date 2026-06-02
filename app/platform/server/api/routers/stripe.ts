// Billing router (legacy name: stripeRouter for backward compat with frontend api.stripe.* calls)
// All billing now goes through Commerce API at billing.hanzo.ai

import {
	findServersByUserId,
	findUserById,
	IS_CLOUD,
} from "@hanzo/platform";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { WEBSITE_URL } from "@/server/utils/billing";
import { adminProcedure, createTRPCRouter, protectedProcedure } from "../trpc";

const COMMERCE_API_URL = process.env.COMMERCE_API_URL || "https://billing.hanzo.ai";
const COMMERCE_SERVICE_TOKEN = process.env.COMMERCE_SERVICE_TOKEN || "";

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
	if (!res.ok) return null;
	return res.json();
}

async function commercePost(path: string, body: Record<string, unknown>): Promise<any> {
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

export const stripeRouter = createTRPCRouter({
	/** Returns the current billing plan for the user's organization. */
	getCurrentPlan: protectedProcedure.query(async ({ ctx }) => {
		if (!IS_CLOUD) return null;
		const owner = await findUserById(ctx.user.ownerId);

		try {
			const subscription = await commerceGet(`/subscriptions?customerId=${encodeURIComponent(owner.id)}`);
			if (!subscription?.plan) return null;

			const plan = subscription.plan;
			if (plan === "startup") return "startup" as const;
			if (plan === "hobby") return "hobby" as const;
			return null;
		} catch {
			return null;
		}
	}),

	getProducts: adminProcedure.query(async ({ ctx }) => {
		const user = await findUserById(ctx.user.ownerId);

		try {
			const data = await commerceGet(`/products?customerId=${encodeURIComponent(user.id)}`);

			return {
				products: data?.products ?? [],
				subscriptions: data?.subscriptions ?? [],
				hobbyProductId: data?.hobbyProductId ?? undefined,
				startupProductId: data?.startupProductId ?? undefined,
				currentPlan: (data?.currentPlan ?? null) as "legacy" | "hobby" | "startup" | null,
				isAnnualCurrent: data?.isAnnualCurrent ?? false,
				currentPriceAmount: data?.currentPriceAmount ?? null,
			};
		} catch {
			return {
				products: [],
				subscriptions: [],
				hobbyProductId: undefined,
				startupProductId: undefined,
				currentPlan: null as "legacy" | "hobby" | "startup" | null,
				isAnnualCurrent: false,
				currentPriceAmount: null,
			};
		}
	}),

	createCheckoutSession: adminProcedure
		.input(
			z
				.object({
					tier: z.enum(["legacy", "hobby", "startup"]),
					productId: z.string(),
					serverQuantity: z.number().min(1),
					isAnnual: z.boolean(),
				})
				.refine((data) => data.tier !== "startup" || data.serverQuantity >= 3, {
					message: "Startup plan requires at least 3 servers",
					path: ["serverQuantity"],
				}),
		)
		.mutation(async ({ ctx, input }) => {
			const owner = await findUserById(ctx.user.ownerId);

			const result = await commercePost("/subscriptions", {
				customerId: owner.id,
				customerEmail: owner.email,
				tier: input.tier,
				serverQuantity: input.serverQuantity,
				isAnnual: input.isAnnual,
				successUrl: `${WEBSITE_URL}/dashboard/settings/servers?success=true`,
				cancelUrl: `${WEBSITE_URL}/dashboard/settings/billing`,
			});

			return { sessionId: result.sessionId || result.id };
		}),

	createCustomerPortalSession: adminProcedure.mutation(async ({ ctx }) => {
		const owner = await findUserById(ctx.user.ownerId);

		try {
			const result = await commercePost("/portal-session", {
				customerId: owner.id,
				returnUrl: `${WEBSITE_URL}/dashboard/settings/billing`,
			});

			return { url: result.url || `${COMMERCE_API_URL}/billing` };
		} catch {
			return { url: `${COMMERCE_API_URL}/billing` };
		}
	}),

	upgradeSubscription: adminProcedure
		.input(
			z
				.object({
					tier: z.enum(["hobby", "startup"]),
					serverQuantity: z.number().min(1),
					isAnnual: z.boolean(),
				})
				.refine((data) => data.tier !== "startup" || data.serverQuantity >= 3, {
					message: "Startup plan requires at least 3 servers",
					path: ["serverQuantity"],
				}),
		)
		.mutation(async ({ ctx, input }) => {
			const owner = await findUserById(ctx.user.ownerId);

			await commercePost("/subscriptions/upgrade", {
				customerId: owner.id,
				tier: input.tier,
				serverQuantity: input.serverQuantity,
				isAnnual: input.isAnnual,
			});

			return { ok: true };
		}),

	canCreateMoreServers: adminProcedure.query(async ({ ctx }) => {
		const user = await findUserById(ctx.user.ownerId);
		const servers = await findServersByUserId(user.id);

		if (!IS_CLOUD) {
			return true;
		}

		return servers.length < user.serversQuantity;
	}),

	getInvoices: adminProcedure.query(async ({ ctx }) => {
		const user = await findUserById(ctx.user.ownerId);

		try {
			const data = await commerceGet(`/invoices?customerId=${encodeURIComponent(user.id)}`);
			if (!data?.invoices) return [];

			return data.invoices.map((invoice: any) => ({
				id: invoice.id,
				number: invoice.number,
				status: invoice.status,
				amountDue: invoice.amountDue,
				amountPaid: invoice.amountPaid,
				currency: invoice.currency || "usd",
				created: invoice.created,
				dueDate: invoice.dueDate,
				hostedInvoiceUrl: invoice.hostedInvoiceUrl,
				invoicePdf: invoice.invoicePdf,
			}));
		} catch {
			return [];
		}
	}),
});
