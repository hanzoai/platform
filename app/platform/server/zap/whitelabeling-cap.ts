// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// whitelabeling-cap.ts — the native @zap-proto/web Whitelabeling capability.
//
// Binary-ZAP replacement for the tRPC `whitelabelingRouter`
// (server/api/routers/enterprise/whitelabeling.ts). The router mixes procedure
// bases:
//   - protectedProcedure  (get) — authenticated caller (session+user);
//   - enterpriseProcedure (update, reset) — owner|admin caller (the body
//                          additionally enforces owner-only via FORBIDDEN);
//   - publicProcedure     (getPublic) — no auth required.
//
// The mint boundary establishes the (possibly absent) caller and threads the
// tRPC-shaped ctx into dispatch. The publicProcedure body (getPublic) handles a
// null caller itself, so the mint does NOT reject on absent auth — it returns a
// ctx with nullable session/user, mirroring publicProcedure. `get` is gated via
// requireAuth (protectedProcedure: session+user); `update`/`reset` via
// requireAdmin (enterpriseProcedure: owner|admin). Inputs ride the shared Args
// carrier (decodeArgs); results the shared Result carrier (encodeResult).
// WhitelabelingMethod ordinals are generated from whitelabeling.zap.

import type { IncomingMessage } from "node:http";
import {
	getWebServerSettings,
	IS_CLOUD,
	updateWebServerSettings,
} from "@hanzo/platform";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { apiUpdateWhitelabeling } from "@/server/db/schema";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import type { z } from "zod";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { WhitelabelingMethod } from "./schema/whitelabeling_zap";

type UpdateWhitelabelingBody = z.infer<typeof apiUpdateWhitelabeling>;

/**
 * Per-connection auth context — the tRPC `ctx` shape the verbatim bodies read
 * (`ctx.user.role`). The publicProcedure body (getPublic) never dereferences
 * these, so user is nullable; the protected/enterprise bodies run only after
 * requireAuth / requireAdmin has established a non-null caller.
 */
export interface WhitelabelingCtx {
	user:
		| {
				role: "owner" | "member" | "admin";
		  }
		| null;
}

/** Typed errors → ZAP status codes (mirror the tRPC error codes). */
class UnauthorizedError extends Error {}
class BadRequestError extends Error {}
class ForbiddenError extends Error {}

/**
 * requireAuth — mirrors `protectedProcedure`: a valid session+user is required;
 * otherwise UNAUTHORIZED. Narrows ctx.user to non-null.
 */
function requireAuth(
	ctx: WhitelabelingCtx,
): asserts ctx is WhitelabelingCtx & { user: NonNullable<WhitelabelingCtx["user"]> } {
	if (!ctx.user) {
		throw new UnauthorizedError("UNAUTHORIZED");
	}
}

/**
 * requireAdmin — mirrors `enterpriseProcedure` (= adminProcedure): a valid
 * session+user is required and the role must be owner|admin; otherwise
 * UNAUTHORIZED. Narrows ctx.user to non-null.
 */
function requireAdmin(
	ctx: WhitelabelingCtx,
): asserts ctx is WhitelabelingCtx & { user: NonNullable<WhitelabelingCtx["user"]> } {
	if (!ctx.user || (ctx.user.role !== "owner" && ctx.user.role !== "admin")) {
		throw new UnauthorizedError("UNAUTHORIZED");
	}
}

/**
 * whitelabelingMintCap — bearer→ctx boundary. Validates the upgrade and captures
 * the tRPC-shaped ctx. The router exposes a publicProcedure method (getPublic)
 * whose body handles a null caller itself, so the mint does NOT reject on absent
 * auth — it returns a ctx with a nullable user, faithfully mirroring
 * publicProcedure. The protected/enterprise bodies are gated per-call via
 * requireAuth / requireAdmin in dispatch.
 */
export const whitelabelingMintCap: MintCap<WhitelabelingCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	const ctxUser =
		session && user
			? {
					role: ((user as { role?: string }).role ??
						"member") as NonNullable<WhitelabelingCtx["user"]>["role"],
				}
			: null;
	return { user: ctxUser };
};

/**
 * whitelabelingRootCap — dispatch each decoded Call by WhitelabelingMethod
 * ordinal to the same service functions the tRPC procedure called. Inputs decode
 * via the shared Args carrier; results encode via the shared Result carrier.
 * Errors map to ZAP status codes (mirroring the tRPC error codes), never a
 * thrown HTTP 500 leak.
 */
export function whitelabelingRootCap(ctx: WhitelabelingCtx): CallHandler {
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

async function dispatch(ctx: WhitelabelingCtx, call: Call): Promise<unknown> {
	// TRPCError shim — the verbatim bodies `throw new TRPCError({ code, message })`.
	// Map each code to the typed error the rootCap catch translates to a ZAP status.
	const TRPCError = class extends Error {
		constructor(opts: { code: string; message?: string }) {
			super(opts.message);
			switch (opts.code) {
				case "UNAUTHORIZED":
					return new UnauthorizedError(opts.message);
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
		case WhitelabelingMethod.get: {
			requireAuth(ctx);
			if (IS_CLOUD) {
				return null;
			}
			const settings = await getWebServerSettings();
			return settings?.whitelabelingConfig ?? null;
		}

		case WhitelabelingMethod.update: {
			requireAdmin(ctx);
			const input = decodeArgs<UpdateWhitelabelingBody>(call.payload);
			if (IS_CLOUD) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Whitelabeling is not available in Cloud",
				});
			}

			if (ctx.user.role !== "owner") {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only the owner can update whitelabeling settings",
				});
			}

			await updateWebServerSettings({
				whitelabelingConfig: input.whitelabelingConfig,
			});

			return { success: true };
		}

		case WhitelabelingMethod.reset: {
			requireAdmin(ctx);
			if (IS_CLOUD) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Whitelabeling is not available in Cloud",
				});
			}

			if (ctx.user.role !== "owner") {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only the owner can reset whitelabeling settings",
				});
			}

			await updateWebServerSettings({
				whitelabelingConfig: {
					appName: null,
					appDescription: null,
					logoUrl: null,
					faviconUrl: null,
					customCss: null,
					loginLogoUrl: null,
					supportUrl: null,
					docsUrl: null,
					errorPageTitle: null,
					errorPageDescription: null,
					metaTitle: null,
					footerText: null,
				},
			});

			return { success: true };
		}

		// Public endpoint only for unauthenticated pages (login, register, error)
		// Returns only the fields needed for public pages
		case WhitelabelingMethod.getPublic: {
			if (IS_CLOUD) {
				return null;
			}
			const settings = await getWebServerSettings();
			const config = settings?.whitelabelingConfig;
			if (!config) return null;

			return {
				appName: config.appName,
				appDescription: config.appDescription,
				logoUrl: config.logoUrl,
				loginLogoUrl: config.loginLogoUrl,
				faviconUrl: config.faviconUrl,
				customCss: config.customCss,
				metaTitle: config.metaTitle,
				errorPageTitle: config.errorPageTitle,
				errorPageDescription: config.errorPageDescription,
				footerText: config.footerText,
			};
		}

		default:
			throw new BadRequestError(`unknown method ${call.method}`);
	}
}
