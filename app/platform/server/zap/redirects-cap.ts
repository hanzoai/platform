// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// redirects-cap.ts — the native @zap-proto/web Redirects capability.
//
// Binary-ZAP replacement for the tRPC `redirectsRouter`
// (server/api/routers/redirects.ts). Every method was a `protectedProcedure`
// (authenticated caller, session+user) whose body additionally enforces
// per-application service permission via checkServicePermissionAndAccess. The
// mint boundary requires session+user (a null return rejects the WS upgrade
// with HTTP 401, mirroring protectedProcedure); the per-application permission
// check is enforced INSIDE dispatch, verbatim from the original procedure
// bodies. Inputs ride the shared Args carrier, results the shared Result
// carrier; RedirectsMethod ordinals are generated from redirects.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// redirects.<action>", …)`, mirroring how registry-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	createRedirect,
	findRedirectById,
	removeRedirectById,
	updateRedirectById,
} from "@hanzo/platform";
import { validateRequest } from "@hanzo/platform/lib/auth";
import { checkServicePermissionAndAccess } from "@hanzo/platform/services/permission";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { RedirectsMethod } from "./schema/redirects_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface RedirectsCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * redirectsMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication half: validates the upgrade and requires session+user. Null →
 * HTTP 401 before any socket opens. The per-application service-permission half
 * runs inside dispatch (verbatim from the bodies).
 */
export const redirectsMintCap: MintCap<RedirectsCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as RedirectsCtx["userRole"];
	const userId = (user as { id?: string }).id || "";
	const email = (user as { email?: string }).email || "";
	return { organizationId, userRole, userId, email };
};

/**
 * permCtx — adapt the flat per-connection RedirectsCtx to the `PermissionCtx`
 * shape (`{ user: { id }, session: { activeOrganizationId } }`) that
 * checkServicePermissionAndAccess reads. The tRPC procedure passed its own
 * nested `ctx` directly; here the minted ctx is flat, so we reshape at the call
 * site. Same values, different access path.
 */
const permCtx = (ctx: RedirectsCtx) => ({
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
 * redirectsRootCap — dispatch each decoded Call by RedirectsMethod ordinal to
 * the same service functions the tRPC procedure called. Inputs decode via the
 * shared Args carrier; results encode via the shared Result carrier. Errors map
 * to ZAP status codes (mirroring the tRPC error codes), never a thrown HTTP 500
 * leak.
 */
export function redirectsRootCap(ctx: RedirectsCtx): CallHandler {
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

async function dispatch(ctx: RedirectsCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case RedirectsMethod.create: {
			const input = decodeArgs<{
				applicationId: string;
				regex: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiCreateRedirect input, ported verbatim
				[k: string]: any;
			}>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				service: ["create"],
			});
			await createRedirect(input);
			console.info("[audit] redirects.create", {
				action: "create",
				resourceType: "redirect",
				resourceId: input.applicationId,
				resourceName: input.regex,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case RedirectsMethod.one: {
			const input = decodeArgs<{ redirectId: string }>(call.payload);
			const redirect = await findRedirectById(input.redirectId);
			await checkServicePermissionAndAccess(permCtx(ctx), redirect.applicationId, {
				service: ["read"],
			});
			return redirect;
		}

		case RedirectsMethod.delete: {
			const input = decodeArgs<{ redirectId: string }>(call.payload);
			const redirect = await findRedirectById(input.redirectId);
			await checkServicePermissionAndAccess(permCtx(ctx), redirect.applicationId, {
				service: ["delete"],
			});
			const result = await removeRedirectById(input.redirectId);
			console.info("[audit] redirects.delete", {
				action: "delete",
				resourceType: "redirect",
				resourceId: input.redirectId,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return result;
		}

		case RedirectsMethod.update: {
			const input = decodeArgs<{
				redirectId: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiUpdateRedirect input, ported verbatim
				[k: string]: any;
			}>(call.payload);
			const redirect = await findRedirectById(input.redirectId);
			await checkServicePermissionAndAccess(permCtx(ctx), redirect.applicationId, {
				service: ["create"],
			});
			const result = await updateRedirectById(input.redirectId, input);
			console.info("[audit] redirects.update", {
				action: "update",
				resourceType: "redirect",
				resourceId: input.redirectId,
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
