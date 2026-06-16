// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// audit-log-cap.ts — the native @zap-proto/web AuditLog capability.
//
// Binary-ZAP replacement for the tRPC `auditLogRouter`
// (server/api/routers/proprietary/audit-log.ts). The single method `all` was
// `withPermission("auditLog", "read")` — an authenticated caller whose
// permission to read audit logs is enforced at the mint/permission boundary —
// with an additional `.use(...)` middleware requiring a valid enterprise
// license (FORBIDDEN otherwise). The mint boundary requires session+user (a
// null return rejects the WS upgrade with HTTP 401, mirroring the authenticated
// base of withPermission); the valid-license gate runs INSIDE dispatch, verbatim
// from the original middleware. Inputs ride the shared Args carrier (decodeArgs);
// results the shared Result carrier (encodeResult). AuditLogMethod ordinals are
// generated from audit-log.zap.

import type { IncomingMessage } from "node:http";
import { validateRequest } from "@hanzo/platform/lib/auth";
import { hasValidLicense } from "@hanzo/platform/services/proprietary/license-key";
import { getAuditLogs } from "@hanzo/platform/services/proprietary/audit-log";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { AuditLogMethod } from "./schema/audit-log_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface AuditLogCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/** Typed errors → ZAP status codes (mirror the tRPC error codes). */
class UnauthorizedError extends Error {}
class NotFoundError extends Error {}
class BadRequestError extends Error {}
class ForbiddenError extends Error {}

/**
 * auditLogMintCap — bearer→ctx boundary. Mirrors the authenticated base of
 * `withPermission("auditLog", "read")`: validates the upgrade and requires
 * session+user. Null → HTTP 401 before any socket opens. The valid-enterprise-
 * license gate runs inside dispatch (verbatim from the `.use(...)` middleware).
 */
export const auditLogMintCap: MintCap<AuditLogCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as AuditLogCtx["userRole"];
	const userId = (user as { id?: string }).id || "";
	const email = (user as { email?: string }).email || "";
	return { organizationId, userRole, userId, email };
};

/**
 * auditLogRootCap — dispatch each decoded Call by AuditLogMethod ordinal to the
 * same service function the tRPC procedure called. Inputs decode via the shared
 * Args carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function auditLogRootCap(ctx: AuditLogCtx): CallHandler {
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
					: err instanceof ForbiddenError
						? Status.Forbidden
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

async function dispatch(ctx: AuditLogCtx, call: Call): Promise<unknown> {
	// TRPCError shim — the verbatim middleware `throw new TRPCError({ code, message })`.
	// Map each code to the typed error the rootCap catch translates to a ZAP status.
	const TRPCError = class extends Error {
		constructor(opts: { code: string; message?: string }) {
			super(opts.message);
			switch (opts.code) {
				case "UNAUTHORIZED":
					return new UnauthorizedError(opts.message);
				case "NOT_FOUND":
					return new NotFoundError(opts.message);
				case "BAD_REQUEST":
					return new BadRequestError(opts.message);
				case "FORBIDDEN":
					return new ForbiddenError(opts.message);
				default:
					return new Error(opts.message);
			}
		}
	};

	switch (call.method) {
		case AuditLogMethod.all: {
			// `.use(...)` middleware: require a valid enterprise license.
			const licensed = await hasValidLicense(ctx.organizationId);
			if (!licensed) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Valid enterprise license required",
				});
			}
			const input = decodeArgs<{
				userId?: string;
				userEmail?: string;
				resourceName?: string;
				action?:
					| "create"
					| "update"
					| "delete"
					| "deploy"
					| "cancel"
					| "redeploy"
					| "login"
					| "logout";
				resourceType?:
					| "project"
					| "service"
					| "environment"
					| "deployment"
					| "user"
					| "customRole"
					| "domain"
					| "certificate"
					| "registry"
					| "server"
					| "sshKey"
					| "gitProvider"
					| "notification"
					| "settings"
					| "session";
				from?: Date;
				to?: Date;
				limit: number;
				offset: number;
			}>(call.payload);
			return getAuditLogs({
				organizationId: ctx.organizationId,
				...input,
			});
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
