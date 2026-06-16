// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// security-cap.ts — the native @zap-proto/web Security capability.
//
// Binary-ZAP replacement for the tRPC `securityRouter`
// (server/api/routers/security.ts). Every method was a `protectedProcedure`
// (authenticated caller, session+user) whose body additionally enforces
// per-application service permission via checkServicePermissionAndAccess. The
// mint boundary requires session+user (a null return rejects the WS upgrade
// with HTTP 401, mirroring protectedProcedure); the per-application permission
// check is enforced INSIDE dispatch, verbatim from the original procedure
// bodies. Inputs ride the shared Args carrier, results the shared Result
// carrier; SecurityMethod ordinals are generated from security.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// security.<action>", …)`, mirroring how redirects-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	createSecurity,
	deleteSecurityById,
	findSecurityById,
	updateSecurityById,
} from "@hanzo/platform";
import { validateRequest } from "@hanzo/platform/lib/auth";
import { checkServicePermissionAndAccess } from "@hanzo/platform/services/permission";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { SecurityMethod } from "./schema/security_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface SecurityCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * securityMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication half: validates the upgrade and requires session+user. Null →
 * HTTP 401 before any socket opens. The per-application service-permission half
 * runs inside dispatch (verbatim from the bodies).
 */
export const securityMintCap: MintCap<SecurityCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as SecurityCtx["userRole"];
	const userId = (user as { id?: string }).id || "";
	const email = (user as { email?: string }).email || "";
	return { organizationId, userRole, userId, email };
};

/**
 * permCtx — adapt the flat per-connection SecurityCtx to the `PermissionCtx`
 * shape (`{ user: { id }, session: { activeOrganizationId } }`) that
 * checkServicePermissionAndAccess reads. The tRPC procedure passed its own
 * nested `ctx` directly; here the minted ctx is flat, so we reshape at the call
 * site. Same values, different access path.
 */
const permCtx = (ctx: SecurityCtx) => ({
	user: { id: ctx.userId },
	session: { activeOrganizationId: ctx.organizationId },
});

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}

/**
 * securityRootCap — dispatch each decoded Call by SecurityMethod ordinal to the
 * same service functions the tRPC procedure called. Inputs decode via the
 * shared Args carrier; results encode via the shared Result carrier. Errors map
 * to ZAP status codes (mirroring the tRPC error codes), never a thrown HTTP 500
 * leak.
 */
export function securityRootCap(ctx: SecurityCtx): CallHandler {
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

async function dispatch(ctx: SecurityCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case SecurityMethod.create: {
			const input = decodeArgs<{
				applicationId: string;
				username: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiCreateSecurity input, ported verbatim
				[k: string]: any;
			}>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				service: ["create"],
			});
			await createSecurity(input);
			console.info("[audit] security.create", {
				action: "create",
				resourceType: "security",
				resourceId: input.applicationId,
				resourceName: input.username,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SecurityMethod.one: {
			const input = decodeArgs<{ securityId: string }>(call.payload);
			const security = await findSecurityById(input.securityId);
			await checkServicePermissionAndAccess(permCtx(ctx), security.applicationId, {
				service: ["read"],
			});
			return security;
		}

		case SecurityMethod.delete: {
			const input = decodeArgs<{ securityId: string }>(call.payload);
			const security = await findSecurityById(input.securityId);
			await checkServicePermissionAndAccess(permCtx(ctx), security.applicationId, {
				service: ["create"],
			});
			const result = await deleteSecurityById(input.securityId);
			console.info("[audit] security.delete", {
				action: "delete",
				resourceType: "security",
				resourceId: input.securityId,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return result;
		}

		case SecurityMethod.update: {
			const input = decodeArgs<{
				securityId: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiUpdateSecurity input, ported verbatim
				[k: string]: any;
			}>(call.payload);
			const security = await findSecurityById(input.securityId);
			await checkServicePermissionAndAccess(permCtx(ctx), security.applicationId, {
				service: ["create"],
			});
			const result = await updateSecurityById(input.securityId, input);
			console.info("[audit] security.update", {
				action: "update",
				resourceType: "security",
				resourceId: input.securityId,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return result;
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
