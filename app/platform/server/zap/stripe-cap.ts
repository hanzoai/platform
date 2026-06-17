// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// stripe-cap.ts — the native @zap-proto/web Stripe (billing) capability.
//
// Binary-ZAP replacement for the tRPC `stripeRouter`
// (server/api/routers/stripe.ts). `getCurrentPlan` was a `protectedProcedure`;
// every other method was an `adminProcedure` (owner|admin only). The mint
// boundary requires session+user (a null return rejects the WS upgrade with
// HTTP 401, mirroring protectedProcedure); the per-call admin gate (mirroring
// adminProcedure) runs INSIDE dispatch via requireAdmin(ctx). Inputs ride the
// shared Args carrier, results the shared Result carrier; StripeMethod ordinals
// are generated from stripe.zap. The file-local Commerce API helpers are ported
// verbatim from stripe.ts.

import type { IncomingMessage } from "node:http";
import {
	findServersByUserId,
	findUserById,
	IS_CLOUD,
} from "@hanzo/platform";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { WEBSITE_URL } from "@/server/utils/billing";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { StripeMethod } from "./schema/stripe_zap";

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

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface StripeCtx {
	user: { id: string; ownerId: string; role: "owner" | "member" | "admin" };
	userRole: "owner" | "member" | "admin";
}

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}

/** Admin gate — mirrors `adminProcedure` (owner|admin only). */
function requireAdmin(ctx: StripeCtx): void {
	if (ctx.userRole !== "owner" && ctx.userRole !== "admin") {
		throw new UnauthorizedError("admin role required");
	}
}

/**
 * stripeMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication: validates the upgrade and requires session+user. Null → HTTP
 * 401 before any socket opens. Admin-only methods are gated per-call in
 * dispatch via requireAdmin(ctx).
 */
export const stripeMintCap: MintCap<StripeCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const id = (user as { id?: string }).id || "";
	const ownerId = (user as { ownerId?: string }).ownerId || "";
	const role = ((user as { role?: string }).role ??
		"member") as StripeCtx["userRole"];
	return { user: { id, ownerId, role }, userRole: role };
};

/**
 * stripeRootCap — dispatch each decoded Call by StripeMethod ordinal to the
 * same Commerce API calls the tRPC procedure made. Inputs decode via the shared
 * Args carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function stripeRootCap(ctx: StripeCtx): CallHandler {
	return async (call: Call): Promise<Response> => {
		try {
			const value = await dispatch(ctx, call);
			return {
				status: Status.OK,
				promiseID: call.promiseID,
				body: encodeResult(value),
			};
		} catch (err) {
			const status =
				err instanceof UnauthorizedError
					? Status.Unauthorized
					: err instanceof NotFoundError
						? Status.NotFound
						: err instanceof BadRequestError
							? Status.BadRequest
							: Status.Internal;
			const message = err instanceof Error ? err.message : "internal error";
			return {
				status,
				promiseID: call.promiseID,
				body: encodeResult({ error: message }),
			};
		}
	};
}

async function dispatch(ctx: StripeCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case StripeMethod.getCurrentPlan: {
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
		}

		case StripeMethod.getProducts: {
			requireAdmin(ctx);
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
		}

		case StripeMethod.createCheckoutSession: {
			requireAdmin(ctx);
			const input = decodeArgs<{
				tier: "legacy" | "hobby" | "startup";
				productId: string;
				serverQuantity: number;
				isAnnual: boolean;
			}>(call.payload);
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
		}

		case StripeMethod.createCustomerPortalSession: {
			requireAdmin(ctx);
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
		}

		case StripeMethod.upgradeSubscription: {
			requireAdmin(ctx);
			const input = decodeArgs<{
				tier: "hobby" | "startup";
				serverQuantity: number;
				isAnnual: boolean;
			}>(call.payload);
			const owner = await findUserById(ctx.user.ownerId);

			await commercePost("/subscriptions/upgrade", {
				customerId: owner.id,
				tier: input.tier,
				serverQuantity: input.serverQuantity,
				isAnnual: input.isAnnual,
			});

			return { ok: true };
		}

		case StripeMethod.canCreateMoreServers: {
			requireAdmin(ctx);
			const user = await findUserById(ctx.user.ownerId);
			const servers = await findServersByUserId(user.id);

			if (!IS_CLOUD) {
				return true;
			}

			return servers.length < user.serversQuantity;
		}

		case StripeMethod.getInvoices: {
			requireAdmin(ctx);
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
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
