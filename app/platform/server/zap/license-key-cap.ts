// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// license-key-cap.ts — the native @zap-proto/web LicenseKey capability.
//
// Binary-ZAP replacement for the tRPC `licenseKeyRouter`
// (server/api/routers/enterprise/license-key.ts):
//   - licenseKeyMintCap: bearer→ctx boundary at the WS upgrade. Requires a
//                        session+user (mirrors `protectedProcedure`, the base of
//                        every method); null → HTTP 401 before any socket opens.
//                        The five `adminProcedure` methods are admin-gated
//                        per-call in dispatch via requireAdmin(ctx); their
//                        bodies' own `ctx.user.role === "owner"` checks remain
//                        verbatim inside dispatch (more restrictive than the
//                        admin gate, ported unchanged).
//   - licenseKeyRootCap: rootCap(ctx) → CallHandler. Dispatches each decoded ZAP
//                        Call by its method ordinal (LicenseKeyMethod, generated
//                        from license-key.zap) to the same service functions /
//                        db queries the tRPC procedure ran, with the same
//                        arguments and the same error throws.
//
// Inputs ride the shared Args carrier (decodeArgs); results the shared Result
// carrier (encodeResult). The LicenseKeyMethod ordinal table is generated from
// license-key.zap.

import type { IncomingMessage } from "node:http";
import { db } from "@hanzo/platform/db";
import { user } from "@hanzo/platform/db/schema";
import { hasValidLicense, validateLicenseKey } from "@hanzo/platform/index";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { eq } from "drizzle-orm";
import {
	activateLicenseKey,
	deactivateLicenseKey,
} from "@/server/utils/enterprise";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { LicenseKeyMethod } from "./schema/license-key_zap";

/**
 * Per-connection auth context — the tRPC ctx shape the ported bodies expect
 * (`ctx.user.id`, `ctx.user.role`, `ctx.session.activeOrganizationId`).
 */
export interface LicenseKeyCtx {
	session: { activeOrganizationId: string };
	user: { id: string; role: "owner" | "member" | "admin" };
}

/** Typed errors → ZAP status codes (mirror the tRPC error codes). */
class NotFoundError extends Error {}
class BadRequestError extends Error {}
class ForbiddenError extends Error {}
class UnauthorizedError extends Error {}

/** Admin gate — mirrors `adminProcedure` (owner|admin only). */
function requireAdmin(ctx: LicenseKeyCtx): void {
	if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
		throw new UnauthorizedError("admin role required");
	}
}

/**
 * licenseKeyMintCap — bearer→ctx boundary. Requires a session+user (mirrors
 * `protectedProcedure`, the base of every method); null → HTTP 401 before any
 * socket opens. Admin-only methods are gated per-call in dispatch.
 */
export const licenseKeyMintCap: MintCap<LicenseKeyCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const activeOrganizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const role = ((user as { role?: string }).role ??
		"member") as LicenseKeyCtx["user"]["role"];
	return {
		session: { activeOrganizationId },
		user: { id: (user as { id: string }).id, role },
	};
};

/**
 * licenseKeyRootCap — the connection's dispatch root. For each decoded Call,
 * decode the input via the shared Args carrier, run the matching service
 * function / db query (the very same one the tRPC procedure ran), and encode the
 * result. Errors map to ZAP status codes, never a thrown HTTP 500 leak.
 */
export function licenseKeyRootCap(ctx: LicenseKeyCtx): CallHandler {
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
				err instanceof ForbiddenError
					? Status.Forbidden
					: err instanceof UnauthorizedError
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

async function dispatch(ctx: LicenseKeyCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case LicenseKeyMethod.activate: {
			requireAdmin(ctx);
			const input = decodeArgs<{ licenseKey: string }>(call.payload);
			try {
				const currentUserId = ctx.user.id;
				const currentUser = await db.query.user.findFirst({
					where: eq(user.id, currentUserId),
				});
				if (!currentUser) {
					throw new NotFoundError("User not found");
				}

				if (ctx.user.role !== "owner") {
					throw new ForbiddenError(
						"You are not authorized to activate a license key",
					);
				}

				if (!currentUser.enableEnterpriseFeatures) {
					throw new BadRequestError(
						"Please activate enterprise features to activate license key",
					);
				}

				await activateLicenseKey(input.licenseKey);
				await db
					.update(user)
					.set({
						licenseKey: input.licenseKey,
						isValidEnterpriseLicense: true,
					})
					.where(eq(user.id, currentUserId));
				return { success: true };
			} catch (error) {
				if (
					error instanceof NotFoundError ||
					error instanceof ForbiddenError ||
					error instanceof BadRequestError
				)
					throw error;
				throw new BadRequestError(
					error instanceof Error
						? error.message
						: "Failed to activate license key",
				);
			}
		}

		case LicenseKeyMethod.validate: {
			requireAdmin(ctx);
			try {
				const currentUserId = ctx.user.id;
				const currentUser = await db.query.user.findFirst({
					where: eq(user.id, currentUserId),
				});
				if (!currentUser) {
					throw new NotFoundError("User not found");
				}

				if (ctx.user.role !== "owner") {
					throw new ForbiddenError(
						"You are not authorized to validate a license key",
					);
				}

				if (!currentUser.licenseKey) {
					throw new BadRequestError("No license key found");
				}

				if (!currentUser.enableEnterpriseFeatures) {
					throw new BadRequestError(
						"Please activate enterprise features to validate license key",
					);
				}
				const valid = await validateLicenseKey(currentUser.licenseKey);
				if (valid) {
					await db
						.update(user)
						.set({ isValidEnterpriseLicense: true })
						.where(eq(user.id, currentUserId));
				}
				return valid;
			} catch (error) {
				if (
					error instanceof NotFoundError ||
					error instanceof ForbiddenError ||
					error instanceof BadRequestError
				)
					throw error;
				throw new BadRequestError(
					error instanceof Error
						? error.message
						: "Failed to validate license key",
				);
			}
		}

		case LicenseKeyMethod.deactivate: {
			requireAdmin(ctx);
			try {
				const currentUserId = ctx.user.id;
				const currentUser = await db.query.user.findFirst({
					where: eq(user.id, currentUserId),
				});
				if (!currentUser) {
					throw new NotFoundError("User not found");
				}
				if (!currentUser.licenseKey) {
					throw new BadRequestError("No license key found");
				}

				if (ctx.user.role !== "owner") {
					throw new ForbiddenError(
						"You are not authorized to deactivate a license key",
					);
				}

				try {
					await deactivateLicenseKey(currentUser.licenseKey);
				} catch (err) {
					console.error("Failed to deactivate license key remotely:", err);
				}

				await db
					.update(user)
					.set({
						licenseKey: null,
						isValidEnterpriseLicense: false,
					})
					.where(eq(user.id, currentUserId));
				return { success: true };
			} catch (error) {
				if (
					error instanceof NotFoundError ||
					error instanceof ForbiddenError ||
					error instanceof BadRequestError
				)
					throw error;
				throw new BadRequestError(
					error instanceof Error
						? error.message
						: "Failed to deactivate license key",
				);
			}
		}

		case LicenseKeyMethod.getEnterpriseSettings: {
			requireAdmin(ctx);
			const currentUserId = ctx.user.id;
			const currentUser = await db.query.user.findFirst({
				where: eq(user.id, currentUserId),
			});

			if (!currentUser) {
				throw new NotFoundError("User not found");
			}

			if (ctx.user.role !== "owner") {
				throw new ForbiddenError(
					"You are not authorized to get enterprise settings",
				);
			}

			return {
				enableEnterpriseFeatures: !!currentUser.enableEnterpriseFeatures,
				licenseKey: currentUser.licenseKey ?? "",
			};
		}

		case LicenseKeyMethod.haveValidLicenseKey: {
			return await hasValidLicense(ctx.session.activeOrganizationId);
		}

		case LicenseKeyMethod.updateEnterpriseSettings: {
			requireAdmin(ctx);
			const input = decodeArgs<{ enableEnterpriseFeatures?: boolean }>(
				call.payload,
			);
			try {
				const currentUserId = ctx.user.id;

				if (input.enableEnterpriseFeatures === undefined) {
					throw new BadRequestError(
						"enableEnterpriseFeatures must be provided",
					);
				}

				if (ctx.user.role !== "owner") {
					throw new ForbiddenError(
						"You are not authorized to update enterprise settings",
					);
				}

				await db
					.update(user)
					.set({
						enableEnterpriseFeatures: input.enableEnterpriseFeatures,
					})
					.where(eq(user.id, currentUserId));

				return true;
			} catch (error) {
				if (
					error instanceof BadRequestError ||
					error instanceof ForbiddenError
				)
					throw error;
				throw new BadRequestError(
					error instanceof Error
						? error.message
						: "Failed to update enterprise settings",
				);
			}
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
