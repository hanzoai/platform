// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// billing-cap.ts — the native @zap-proto/web Billing capability.
//
// Binary-ZAP replacement for the tRPC `billingRouter`
// (server/api/routers/billing.ts). Every method was a `protectedProcedure` — an
// authenticated caller (session+user) whose body operates on its active
// organization. The mint boundary requires session+user (a null return rejects
// the WS upgrade with HTTP 401, mirroring protectedProcedure); the procedure
// bodies are ported verbatim into dispatch. Inputs ride the shared Args carrier,
// results the shared Result carrier; BillingMethod ordinals are generated from
// billing.zap.

import type { IncomingMessage } from "node:http";
import { findUserById } from "@hanzo/platform";
import {
	createCustomerPortalSession,
	createManualTopup,
	createSubscription,
} from "@hanzo/platform/billing/stripe-service";
import { getPlans, normalizePlanType } from "@hanzo/platform/billing/pricing";
import type { PlanType } from "@hanzo/platform/billing/pricing";
import {
	addCreditsToWallet,
	createOrganizationWallet,
	getOrganizationWallet,
	getWalletBalance,
} from "@hanzo/platform/billing/wallet-service";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { BillingMethod } from "./schema/billing_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface BillingCtx {
	organizationId: string;
	userId: string;
}

/**
 * billingMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication: validates the upgrade and requires session+user. Null → HTTP
 * 401 before any socket opens.
 */
export const billingMintCap: MintCap<BillingCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userId = (user as { id?: string }).id || "";
	return { organizationId, userId };
};

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}

/**
 * billingRootCap — dispatch each decoded Call by BillingMethod ordinal to the
 * same service functions the tRPC procedure called. Inputs decode via the shared
 * Args carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function billingRootCap(ctx: BillingCtx): CallHandler {
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

async function dispatch(ctx: BillingCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case BillingMethod.getWallet: {
			try {
				return await getOrganizationWallet(ctx.organizationId);
			} catch {
				return null;
			}
		}

		case BillingMethod.getBalance: {
			try {
				const balance = await getWalletBalance(ctx.organizationId);
				return { balance };
			} catch {
				return { balance: 0 };
			}
		}

		case BillingMethod.createSubscription: {
			const input = decodeArgs<{
				plan: "developer" | "pro" | "team" | "enterprise" | "hobby";
			}>(call.payload);
			const user = await findUserById(ctx.userId);
			const wallet = await getOrganizationWallet(ctx.organizationId);

			// Normalize legacy "hobby" -> "developer" before passing downstream.
			const plan = normalizePlanType(input.plan) as PlanType;

			return await createSubscription({
				organizationId: ctx.organizationId,
				ownerId: user.id,
				ownerEmail: user.email,
				plan,
				stripeCustomerId:
					wallet?.stripeCustomerId ?? wallet?.organizationId ?? undefined,
			});
		}

		case BillingMethod.addCredits: {
			const input = decodeArgs<{ amount: number }>(call.payload);
			const wallet = await getOrganizationWallet(ctx.organizationId);
			const customerId = wallet?.stripeCustomerId || wallet?.organizationId;
			if (!customerId) throw new Error("No subscription");

			return await createManualTopup({
				organizationId: ctx.organizationId,
				amount: input.amount,
				stripeCustomerId: customerId,
			});
		}

		case BillingMethod.getPlans: {
			return await getPlans();
		}

		case BillingMethod.createPortalSession: {
			return await createCustomerPortalSession(ctx.organizationId);
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
