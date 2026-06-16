// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// git-provider-cap.ts — the native @zap-proto/web GitProvider capability.
//
// Binary-ZAP replacement for the tRPC `gitProviderRouter`
// (server/api/routers/git-provider.ts). `getAll`/`toggleShare` were
// `protectedProcedure`; `allForPermissions` was `withPermission("member",
// "update")` plus an enterprise-license gate; `remove` was
// `withPermission("gitProviders", "delete")` — authenticated callers (session+
// user) whose bodies additionally enforce per-provider org ownership. The mint
// boundary requires session+user (a null return rejects the WS upgrade with
// HTTP 401, mirroring protectedProcedure); the per-provider ownership / license
// checks are enforced INSIDE dispatch, verbatim from the original procedure
// bodies. Inputs ride the shared Args carrier, results the shared Result
// carrier; GitProviderMethod ordinals are generated from git-provider.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// gitProvider.<action>", …)`, mirroring how registry-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	findGitProviderById,
	getAccessibleGitProviderIds,
	hasValidLicense,
	removeGitProvider,
	updateGitProvider,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { desc, eq, inArray } from "drizzle-orm";
import { gitProvider } from "@/server/db/schema";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { GitProviderMethod } from "./schema/git-provider_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface GitProviderCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * gitProviderMintCap — bearer→ctx boundary. Mirrors the router's authentication
 * half (a `protectedProcedure` base): validates the upgrade and requires
 * session+user. Null → HTTP 401 before any socket opens. The per-provider org-
 * ownership and enterprise-license halves run inside dispatch (verbatim from the
 * bodies).
 */
export const gitProviderMintCap: MintCap<GitProviderCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as GitProviderCtx["userRole"];
	const userId = (user as { id?: string }).id || "";
	const email = (user as { email?: string }).email || "";
	return { organizationId, userRole, userId, email };
};

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}
/** Typed permission failure → ZAP Status.Forbidden. */
class ForbiddenError extends Error {}

/**
 * gitProviderRootCap — dispatch each decoded Call by GitProviderMethod ordinal
 * to the same service functions the tRPC procedure called. Inputs decode via the
 * shared Args carrier; results encode via the shared Result carrier. Errors map
 * to ZAP status codes (mirroring the tRPC error codes), never a thrown HTTP 500
 * leak.
 */
export function gitProviderRootCap(ctx: GitProviderCtx): CallHandler {
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

async function dispatch(ctx: GitProviderCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case GitProviderMethod.getAll: {
			const accessibleIds = await getAccessibleGitProviderIds({
				userId: ctx.userId,
				activeOrganizationId: ctx.organizationId,
			});

			if (accessibleIds.size === 0) {
				return [];
			}

			const results = await db.query.gitProvider.findMany({
				with: {
					gitlab: true,
					bitbucket: true,
					github: true,
					gitea: true,
				},
				orderBy: desc(gitProvider.createdAt),
				where: inArray(gitProvider.gitProviderId, [...accessibleIds]),
			});

			return results.map((r) => ({
				...r,
				isOwner: r.userId === ctx.userId,
			}));
		}

		case GitProviderMethod.toggleShare: {
			const input = decodeArgs<{
				gitProviderId: string;
				sharedWithOrganization?: boolean;
			}>(call.payload);
			const provider = await findGitProviderById(input.gitProviderId);

			if (
				provider.userId !== ctx.userId ||
				provider.organizationId !== ctx.organizationId
			) {
				throw new UnauthorizedError("Only the owner can share this provider");
			}

			console.info("[audit] gitProvider.update", {
				action: "update",
				resourceType: "gitProvider",
				resourceId: provider.gitProviderId,
				resourceName: provider.name ?? provider.gitProviderId,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});

			return await updateGitProvider(input.gitProviderId, {
				sharedWithOrganization: input.sharedWithOrganization,
			});
		}

		case GitProviderMethod.allForPermissions: {
			const licensed = await hasValidLicense(ctx.organizationId);
			if (!licensed) {
				throw new ForbiddenError("Valid enterprise license required");
			}
			return await db.query.gitProvider.findMany({
				columns: {
					gitProviderId: true,
					name: true,
					providerType: true,
				},
				orderBy: desc(gitProvider.createdAt),
				where: eq(gitProvider.organizationId, ctx.organizationId),
			});
		}

		case GitProviderMethod.remove: {
			const input = decodeArgs<{ gitProviderId: string }>(call.payload);
			try {
				const gitProviderData = await findGitProviderById(input.gitProviderId);

				if (gitProviderData.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You are not allowed to delete this Git provider",
					);
				}
				console.info("[audit] gitProvider.delete", {
					action: "delete",
					resourceType: "gitProvider",
					resourceId: gitProviderData.gitProviderId,
					resourceName: gitProviderData.name ?? gitProviderData.gitProviderId,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return await removeGitProvider(input.gitProviderId);
			} catch (error) {
				if (error instanceof UnauthorizedError) throw error;
				const message =
					error instanceof Error
						? error.message
						: "Error deleting this Git provider";
				throw new BadRequestError(message);
			}
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
