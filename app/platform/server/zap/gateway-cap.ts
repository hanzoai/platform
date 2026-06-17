// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// gateway-cap.ts — the native @zap-proto/web Gateway capability.
//
// Binary-ZAP replacement for the tRPC `gatewayRouter`
// (server/api/routers/gateway.ts). Every method was `adminProcedure`, so the
// mint boundary requires an admin/owner role and a null return rejects the WS
// upgrade with HTTP 401. Inputs ride the shared Args carrier, results the shared
// Result carrier; GatewayMethod ordinals are generated from gateway.zap.

import type { IncomingMessage } from "node:http";
import { validateRequest } from "@hanzo/platform/lib/auth";
import {
	createRateLimitRule,
	createRoutingRule,
	deleteRateLimitRule,
	deleteRoutingRule,
	getGatewayStatus,
	listRateLimitRules,
	listRoutingRules,
	updateRateLimitRule,
	updateRoutingRule,
} from "@hanzo/platform/services/gateway";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { GatewayMethod } from "./schema/gateway_zap";

/** Per-connection auth context. Gateway methods are all admin-gated. */
export interface GatewayCtx {
	userRole: "owner" | "member" | "admin";
}

/**
 * gatewayMintCap — bearer→ctx boundary. Mirrors `adminProcedure`: validates the
 * upgrade and requires an owner|admin role. Null → HTTP 401 before any socket
 * opens, so non-admins never reach dispatch.
 */
export const gatewayMintCap: MintCap<GatewayCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const userRole = ((user as { role?: string }).role ??
		"member") as GatewayCtx["userRole"];
	if (userRole !== "owner" && userRole !== "admin") return null;
	return { userRole };
};

class BadRequestError extends Error {}
class NotFoundError extends Error {}

/**
 * gatewayRootCap — dispatch each decoded Call by GatewayMethod ordinal to the
 * same service function the tRPC procedure called. Inputs decode via the shared
 * Args carrier; results encode via the shared Result carrier.
 */
export function gatewayRootCap(_ctx: GatewayCtx): CallHandler {
	return async (call: Call): Promise<Response> => {
		try {
			const value = await dispatch(call);
			return {
				status: Status.OK,
				promiseID: call.promiseID,
				body: encodeResult(value),
			};
		} catch (err) {
			const status =
				err instanceof NotFoundError
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

async function dispatch(call: Call): Promise<unknown> {
	switch (call.method) {
		case GatewayMethod.status:
			return getGatewayStatus();
		case GatewayMethod.listRateLimits:
			return listRateLimitRules();
		case GatewayMethod.createRateLimit:
			return createRateLimitRule(decodeArgs(call.payload));
		case GatewayMethod.updateRateLimit:
			return updateRateLimitRule(decodeArgs(call.payload));
		case GatewayMethod.deleteRateLimit: {
			const input = decodeArgs<{ rateLimitRuleId: string }>(call.payload);
			return deleteRateLimitRule(input.rateLimitRuleId);
		}
		case GatewayMethod.listRoutes:
			return listRoutingRules();
		case GatewayMethod.createRoute:
			return createRoutingRule(decodeArgs(call.payload));
		case GatewayMethod.updateRoute:
			return updateRoutingRule(decodeArgs(call.payload));
		case GatewayMethod.deleteRoute: {
			const input = decodeArgs<{ routingRuleId: string }>(call.payload);
			return deleteRoutingRule(input.routingRuleId);
		}
		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
