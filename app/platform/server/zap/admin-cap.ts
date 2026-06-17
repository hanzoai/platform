// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// admin-cap.ts — the native @zap-proto/web Admin capability.
//
// Binary-ZAP replacement for the tRPC `adminRouter`
// (server/api/routers/admin.ts):
//   - adminMintCap:  bearer→ctx boundary at the WS upgrade. Mirrors the tRPC
//                    procedure's gating: a session+user is required (replaces
//                    `protectedProcedure`); a null return rejects the upgrade
//                    with HTTP 401. The per-method admin gating (the
//                    `adminProcedure` method) is enforced in dispatch via
//                    requireAdmin(ctx).
//   - adminRootCap:  rootCap(ctx) → CallHandler. Dispatches each decoded ZAP
//                    Call by its method ordinal (AdminMethod, generated from
//                    admin.zap) to the same service functions the tRPC
//                    procedure called, with the same arguments and the same
//                    error throws.
//
// Inputs ride the shared Args carrier (decodeArgs); results the shared Result
// carrier (encodeResult). The AdminMethod ordinal table is generated from
// admin.zap.

import type { IncomingMessage } from "node:http";
import {
	getWebServerSettings,
	IS_CLOUD,
	setupWebMonitoring,
	updateWebServerSettings,
} from "@hanzo/platform";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { AdminMethod } from "./schema/admin_zap";

/**
 * Per-connection auth context — the minted value `serve()` threads into
 * rootCap. `userRole` is the gate the `adminProcedure` method consults.
 */
export interface AdminCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}

/** Admin gate — mirrors `adminProcedure` (owner|admin only). */
function requireAdmin(ctx: AdminCtx): void {
	if (ctx.userRole !== "owner" && ctx.userRole !== "admin") {
		throw new UnauthorizedError("admin role required");
	}
}

/**
 * adminMintCap — bearer→ctx boundary. Requires a session+user (mirrors
 * `protectedProcedure`); null → HTTP 401 before any socket opens. The
 * admin-only method is gated per-call in dispatch via requireAdmin(ctx).
 */
export const adminMintCap: MintCap<AdminCtx> = async (req: IncomingMessage) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as AdminCtx["userRole"];
	const userId = (user as { id?: string }).id || "";
	const email = (user as { email?: string }).email || "";
	return { organizationId, userRole, userId, email };
};

/**
 * adminRootCap — the connection's dispatch root. For each decoded Call, decode
 * the input via the shared Args carrier, run the matching service function (the
 * very same one the tRPC procedure ran), and encode the result. Errors map to
 * ZAP status codes, never a thrown HTTP 500 leak.
 */
export function adminRootCap(ctx: AdminCtx): CallHandler {
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

async function dispatch(ctx: AdminCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case AdminMethod.setupMonitoring: {
			requireAdmin(ctx);
			// biome-ignore lint/suspicious/noExplicitAny: apiUpdateWebServerMonitoring input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			if (IS_CLOUD) {
				throw new UnauthorizedError("Feature disabled on cloud");
			}

			await updateWebServerSettings({
				metricsConfig: {
					server: {
						type: "Hanzo Platform",
						refreshRate: input.metricsConfig.server.refreshRate,
						port: input.metricsConfig.server.port,
						token: input.metricsConfig.server.token,
						cronJob: input.metricsConfig.server.cronJob,
						urlCallback: input.metricsConfig.server.urlCallback,
						retentionDays: input.metricsConfig.server.retentionDays,
						thresholds: {
							cpu: input.metricsConfig.server.thresholds.cpu,
							memory: input.metricsConfig.server.thresholds.memory,
						},
					},
					containers: {
						refreshRate: input.metricsConfig.containers.refreshRate,
						services: {
							include: input.metricsConfig.containers.services.include || [],
							exclude: input.metricsConfig.containers.services.exclude || [],
						},
					},
				},
			});

			await setupWebMonitoring();
			const settings = await getWebServerSettings();
			return settings;
		}

		default:
			throw new UnauthorizedError(`unknown method ${call.method}`);
	}
}
