// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// sso-cap.ts — the native @zap-proto/web Sso capability.
//
// Binary-ZAP replacement for the tRPC `ssoRouter`
// (server/api/routers/enterprise/sso.ts). The router mixes procedure bases:
//   - publicProcedure     (showSignInWithSSO, enforceSSO) — no auth required;
//   - enterpriseProcedure (listProviders, getTrustedOrigins, one, update,
//                          deleteProvider, register, addTrustedOrigin,
//                          removeTrustedOrigin, updateTrustedOrigin) — an
//                          owner|admin caller (enterpriseProcedure aliases
//                          adminProcedure).
//
// The mint boundary establishes the (possibly absent) caller and threads the
// tRPC-shaped ctx into dispatch. The publicProcedure methods tolerate a null
// session/user inside their own bodies, so the mint does NOT reject when auth
// is absent — it returns a ctx with nullable session/user, mirroring
// publicProcedure. The enterpriseProcedure methods are gated per-call via
// requireAdmin(ctx), reproducing the adminProcedure middleware (a missing
// session/user or a non-owner|admin role → UNAUTHORIZED). Inputs ride the
// shared Args carrier (decodeArgs); results the shared Result carrier
// (encodeResult). SsoMethod ordinals are generated from sso.zap.

import type { IncomingMessage } from "node:http";
import { normalizeTrustedOrigin } from "@hanzo/platform";
import { IS_CLOUD } from "@hanzo/platform/constants";
import { db } from "@hanzo/platform/db";
import { member, ssoProvider, user } from "@hanzo/platform/db/schema";
import type { ssoProviderBodySchema } from "@hanzo/platform/db/schema/sso";
import {
	getOrganizationOwnerId,
	getWebServerSettings,
	requestToHeaders,
} from "@hanzo/platform/index";
import { auth, validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { SsoMethod } from "./schema/sso_zap";

type SsoProviderBody = z.infer<typeof ssoProviderBodySchema>;

/**
 * Per-connection auth context — the tRPC `ctx` shape the verbatim bodies read
 * (`ctx.session.activeOrganizationId`, `ctx.session.userId`, `ctx.req`). The
 * publicProcedure bodies never dereference these, so session/user are nullable;
 * the enterpriseProcedure bodies run only after requireAdmin(ctx) has
 * established a non-null owner|admin caller.
 */
export interface SsoCtx {
	session:
		| {
				activeOrganizationId: string;
				userId: string;
		  }
		| null;
	user:
		| {
				role: "owner" | "member" | "admin";
		  }
		| null;
	req: IncomingMessage;
}

/** Typed errors → ZAP status codes (mirror the tRPC error codes). */
class UnauthorizedError extends Error {}
class NotFoundError extends Error {}
class BadRequestError extends Error {}
class ForbiddenError extends Error {}
class InternalError extends Error {}

/**
 * requireAdmin — mirrors the `enterpriseProcedure` (= adminProcedure)
 * middleware: a valid session+user is required and the role must be owner|admin;
 * otherwise UNAUTHORIZED. Narrows ctx.session/ctx.user to non-null.
 */
function requireAdmin(
	ctx: SsoCtx,
): asserts ctx is SsoCtx & {
	session: NonNullable<SsoCtx["session"]>;
	user: NonNullable<SsoCtx["user"]>;
} {
	if (
		!ctx.session ||
		!ctx.user ||
		(ctx.user.role !== "owner" && ctx.user.role !== "admin")
	) {
		throw new UnauthorizedError("UNAUTHORIZED");
	}
}

/**
 * ssoMintCap — bearer→ctx boundary. Validates the upgrade and captures the
 * tRPC-shaped ctx. The router exposes publicProcedure methods (showSignInWithSSO,
 * enforceSSO) whose bodies handle a null caller themselves, so the mint does NOT
 * reject on absent auth — it returns a ctx with nullable session/user,
 * faithfully mirroring publicProcedure. The enterpriseProcedure bodies are gated
 * per-call via requireAdmin in dispatch.
 */
export const ssoMintCap: MintCap<SsoCtx> = async (req: IncomingMessage) => {
	const { session, user } = await validateRequest(req);
	const ctxSession = session
		? {
				activeOrganizationId:
					(session as { activeOrganizationId?: string }).activeOrganizationId ||
					"",
				userId: (session as { userId?: string }).userId || "",
			}
		: null;
	const ctxUser = user
		? {
				role: ((user as { role?: string }).role ??
					"member") as NonNullable<SsoCtx["user"]>["role"],
			}
		: null;
	return { session: ctxSession, user: ctxUser, req };
};

/**
 * ssoRootCap — dispatch each decoded Call by SsoMethod ordinal to the same
 * service functions / queries the tRPC procedure ran. Inputs decode via the
 * shared Args carrier; results encode via the shared Result carrier. Errors map
 * to ZAP status codes (mirroring the tRPC error codes), never a thrown HTTP 500
 * leak.
 */
export function ssoRootCap(ctx: SsoCtx): CallHandler {
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

async function dispatch(ctx: SsoCtx, call: Call): Promise<unknown> {
	// TRPCError shim — the verbatim bodies `throw new TRPCError({ code, message })`.
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
				case "INTERNAL_SERVER_ERROR":
					return new InternalError(opts.message);
				default:
					return new Error(opts.message);
			}
		}
	};

	switch (call.method) {
		case SsoMethod.showSignInWithSSO: {
			return true;
		}

		case SsoMethod.enforceSSO: {
			if (IS_CLOUD) {
				return false;
			}
			const settings = await getWebServerSettings();
			return settings?.enforceSSO ?? false;
		}

		case SsoMethod.listProviders: {
			requireAdmin(ctx);
			const providers = await db.query.ssoProvider.findMany({
				where: and(
					eq(ssoProvider.organizationId, ctx.session.activeOrganizationId),
					eq(ssoProvider.userId, ctx.session.userId),
				),
				columns: {
					id: true,
					providerId: true,
					issuer: true,
					domain: true,
					oidcConfig: true,
					samlConfig: true,
					organizationId: true,
				},
				orderBy: [asc(ssoProvider.createdAt)],
			});
			return providers;
		}

		case SsoMethod.getTrustedOrigins: {
			requireAdmin(ctx);
			const ownerId = await getOrganizationOwnerId(
				ctx.session.activeOrganizationId,
			);
			if (!ownerId) return [];
			const ownerUser = await db.query.user.findFirst({
				where: eq(user.id, ownerId),
				columns: { trustedOrigins: true },
			});
			return ownerUser?.trustedOrigins ?? [];
		}

		case SsoMethod.one: {
			requireAdmin(ctx);
			const input = decodeArgs<{ providerId: string }>(call.payload);
			const provider = await db.query.ssoProvider.findFirst({
				where: and(
					eq(ssoProvider.providerId, input.providerId),
					eq(ssoProvider.organizationId, ctx.session.activeOrganizationId),
					eq(ssoProvider.userId, ctx.session.userId),
				),
				columns: {
					id: true,
					providerId: true,
					issuer: true,
					domain: true,
					oidcConfig: true,
					samlConfig: true,
					organizationId: true,
				},
			});
			if (!provider) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message:
						"SSO provider not found or you do not have permission to access it",
				});
			}
			return provider;
		}

		case SsoMethod.update: {
			requireAdmin(ctx);
			const input = decodeArgs<SsoProviderBody>(call.payload);
			const existing = await db.query.ssoProvider.findFirst({
				where: and(
					eq(ssoProvider.providerId, input.providerId),
					eq(ssoProvider.organizationId, ctx.session.activeOrganizationId),
					eq(ssoProvider.userId, ctx.session.userId),
				),
				columns: {
					id: true,
					issuer: true,
					domain: true,
				},
			});

			if (!existing) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message:
						"SSO provider not found or you do not have permission to update it",
				});
			}

			const providers = await db.query.ssoProvider.findMany({
				where: eq(ssoProvider.organizationId, ctx.session.activeOrganizationId),
				columns: { providerId: true, domain: true },
			});

			for (const provider of providers) {
				if (provider.providerId === input.providerId) continue;
				const providerDomains = provider.domain
					.split(",")
					.map((d) => d.trim().toLowerCase());
				for (const domain of input.domains) {
					if (providerDomains.includes(domain)) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `Domain ${domain} is already registered for another provider`,
						});
					}
				}
			}

			const issuerChanged =
				normalizeTrustedOrigin(existing.issuer) !==
				normalizeTrustedOrigin(input.issuer);
			if (issuerChanged) {
				const ownerId = await getOrganizationOwnerId(
					ctx.session.activeOrganizationId,
				);
				if (!ownerId) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Organization owner not found",
					});
				}
				const ownerUser = await db.query.user.findFirst({
					where: eq(user.id, ownerId),
					columns: { trustedOrigins: true },
				});
				const trustedOrigins = ownerUser?.trustedOrigins ?? [];
				const newOrigin = normalizeTrustedOrigin(input.issuer);
				const isInTrustedOrigins = trustedOrigins.some(
					(o) => o.toLowerCase() === newOrigin.toLowerCase(),
				);
				if (!isInTrustedOrigins) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message:
							"The new Issuer URL is not in the organization's trusted origins list. Please add it in Manage origins before saving.",
					});
				}
			}

			const domain = input.domains.join(",");
			const updateBody: {
				providerId: string;
				issuer: string;
				domain: string;
				oidcConfig?: (typeof input)["oidcConfig"];
				samlConfig?: (typeof input)["samlConfig"];
			} = {
				issuer: input.issuer,
				domain,
				providerId: input.providerId,
			};
			if (input.oidcConfig != null) {
				updateBody.oidcConfig = input.oidcConfig;
			}
			if (input.samlConfig != null) {
				updateBody.samlConfig = input.samlConfig;
			}

			await auth.updateSSOProvider({
				params: { providerId: input.providerId },
				body: updateBody,
				headers: requestToHeaders(ctx.req),
			});
			return { success: true };
		}

		case SsoMethod.deleteProvider: {
			requireAdmin(ctx);
			const input = decodeArgs<{ providerId: string }>(call.payload);
			// Obtener el provider antes de eliminarlo para obtener sus dominios
			const providerToDelete = await db.query.ssoProvider.findFirst({
				where: and(
					eq(ssoProvider.providerId, input.providerId),
					eq(ssoProvider.organizationId, ctx.session.activeOrganizationId),
					eq(ssoProvider.userId, ctx.session.userId),
				),
				columns: {
					id: true,
					domain: true,
					issuer: true,
				},
			});

			if (!providerToDelete) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message:
						"SSO provider not found or you do not have permission to delete it",
				});
			}

			const [deleted] = await db
				.delete(ssoProvider)
				.where(
					and(
						eq(ssoProvider.providerId, input.providerId),
						eq(ssoProvider.organizationId, ctx.session.activeOrganizationId),
						eq(ssoProvider.userId, ctx.session.userId),
					),
				)
				.returning({ id: ssoProvider.id });

			if (!deleted) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message:
						"SSO provider not found or you do not have permission to delete it",
				});
			}

			return { success: true };
		}

		case SsoMethod.register: {
			requireAdmin(ctx);
			const input = decodeArgs<SsoProviderBody>(call.payload);
			const organizationId = ctx.session.activeOrganizationId;

			const providers = await db.query.ssoProvider.findMany({
				columns: {
					domain: true,
				},
			});

			for (const provider of providers) {
				const providerDomains = provider.domain
					.split(",")
					.map((d) => d.trim().toLowerCase());
				for (const domain of input.domains) {
					if (providerDomains.includes(domain)) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `Domain ${domain} is already registered for another provider`,
						});
					}
				}
			}
			const domain = input.domains.join(",");

			await auth.registerSSOProvider({
				body: {
					...input,
					organizationId,
					domain,
				},
				headers: requestToHeaders(ctx.req),
			});
			return { success: true };
		}

		case SsoMethod.addTrustedOrigin: {
			requireAdmin(ctx);
			const input = decodeArgs<{ origin: string }>(call.payload);
			const ownerId = await getOrganizationOwnerId(
				ctx.session.activeOrganizationId,
			);
			if (!ownerId) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Organization owner not found",
				});
			}
			const normalized = normalizeTrustedOrigin(input.origin);
			const ownerUser = await db.query.user.findFirst({
				where: eq(user.id, ownerId),
				columns: { trustedOrigins: true },
			});
			const existing = ownerUser?.trustedOrigins || [];
			if (existing.some((o) => o.toLowerCase() === normalized.toLowerCase())) {
				return { success: true };
			}
			const next = Array.from(new Set([...existing, normalized]));
			await db
				.update(user)
				.set({ trustedOrigins: next })
				.where(eq(user.id, ownerId));
			return { success: true };
		}

		case SsoMethod.removeTrustedOrigin: {
			requireAdmin(ctx);
			const input = decodeArgs<{ origin: string }>(call.payload);
			const ownerId = await getOrganizationOwnerId(
				ctx.session.activeOrganizationId,
			);
			if (!ownerId) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Organization owner not found",
				});
			}
			const normalized = normalizeTrustedOrigin(input.origin);
			const ownerUser = await db.query.user.findFirst({
				where: eq(user.id, ownerId),
				columns: { trustedOrigins: true },
			});
			const existing = ownerUser?.trustedOrigins || [];
			const next = existing.filter(
				(o) => o.toLowerCase() !== normalized.toLowerCase(),
			);
			await db
				.update(user)
				.set({ trustedOrigins: next })
				.where(eq(user.id, ownerId));
			return { success: true };
		}

		case SsoMethod.updateTrustedOrigin: {
			requireAdmin(ctx);
			const input = decodeArgs<{ oldOrigin: string; newOrigin: string }>(
				call.payload,
			);
			const ownerId = await getOrganizationOwnerId(
				ctx.session.activeOrganizationId,
			);
			if (!ownerId) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Organization owner not found",
				});
			}
			const oldNorm = normalizeTrustedOrigin(input.oldOrigin);
			const newNorm = normalizeTrustedOrigin(input.newOrigin);
			const ownerUser = await db.query.user.findFirst({
				where: eq(user.id, ownerId),
				columns: { trustedOrigins: true },
			});
			const existing = ownerUser?.trustedOrigins || [];
			const next = existing.map((o) =>
				o.toLowerCase() === oldNorm.toLowerCase() ? newNorm : o,
			);
			await db
				.update(user)
				.set({ trustedOrigins: next })
				.where(eq(user.id, ownerId));
			return { success: true };
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
