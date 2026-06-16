// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// gitea-cap.ts — the native @zap-proto/web Gitea capability.
//
// Binary-ZAP replacement for the tRPC `giteaRouter`
// (server/api/routers/gitea.ts). `create` and `update` were
// `withPermission("gitProviders", "create")`; the rest were
// `protectedProcedure` — both reduce to an authenticated caller (session+user)
// on this branch. The mint boundary requires session+user (a null return
// rejects the WS upgrade with HTTP 401, mirroring protectedProcedure); the
// per-org filtering in `giteaProviders` is enforced INSIDE dispatch, verbatim
// from the original procedure body. Inputs ride the shared Args carrier,
// results the shared Result carrier; GiteaMethod ordinals are generated from
// gitea.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// gitea.<action>", …)`, mirroring how registry-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	createGitea,
	findGiteaById,
	getAccessibleGitProviderIds,
	getGiteaBranches,
	getGiteaRepositories,
	haveGiteaRequirements,
	testGiteaConnection,
	updateGitea,
	updateGitProvider,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { GiteaMethod } from "./schema/gitea_zap";

/**
 * Per-connection auth context — the tRPC ctx shape the ported bodies expect:
 * `ctx.session.activeOrganizationId` / `ctx.session.userId` (the
 * getAccessibleGitProviderIds + create/audit fields).
 */
export interface GiteaCtx {
	session: { activeOrganizationId: string; userId: string };
}

/**
 * giteaMintCap — bearer→ctx boundary. Mirrors `protectedProcedure` /
 * `withPermission("gitProviders", …)`'s authentication half: validates the
 * upgrade and requires session+user. Null → HTTP 401 before any socket opens.
 * The per-org filtering half runs inside dispatch (verbatim from the bodies).
 */
export const giteaMintCap: MintCap<GiteaCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const activeOrganizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userId = (user as { id?: string }).id || "";
	return { session: { activeOrganizationId, userId } };
};

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}

/**
 * giteaRootCap — dispatch each decoded Call by GiteaMethod ordinal to the same
 * service functions the tRPC procedure called. Inputs decode via the shared Args
 * carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function giteaRootCap(ctx: GiteaCtx): CallHandler {
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

async function dispatch(ctx: GiteaCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case GiteaMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: apiCreateGitea input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			try {
				const result = await createGitea(
					input,
					ctx.session.activeOrganizationId,
					ctx.session.userId,
				);

				console.info("[audit] gitea.create", {
					action: "create",
					resourceType: "gitProvider",
					resourceId: result.giteaId,
					resourceName: input.name,
					organizationId: ctx.session.activeOrganizationId,
					userId: ctx.session.userId,
				});

				return result;
			} catch (error) {
				throw new BadRequestError("Error creating this Gitea provider");
			}
		}

		case GiteaMethod.one: {
			const input = decodeArgs<{ giteaId: string }>(call.payload);
			return await findGiteaById(input.giteaId);
		}

		case GiteaMethod.giteaProviders: {
			const accessibleIds = await getAccessibleGitProviderIds(ctx.session);

			let result = await db.query.gitea.findMany({
				with: {
					gitProvider: true,
				},
			});

			result = result.filter(
				(provider) =>
					provider.gitProvider.organizationId ===
						ctx.session.activeOrganizationId &&
					accessibleIds.has(provider.gitProvider.gitProviderId),
			);

			const filtered = result
				.filter((provider) => haveGiteaRequirements(provider))
				.map((provider) => {
					return {
						giteaId: provider.giteaId,
						gitProvider: {
							...provider.gitProvider,
						},
					};
				});

			return filtered;
		}

		case GiteaMethod.getGiteaRepositories: {
			const input = decodeArgs<{ giteaId: string }>(call.payload);
			const { giteaId } = input;

			if (!giteaId) {
				throw new BadRequestError("Gitea provider ID is required.");
			}

			try {
				const repositories = await getGiteaRepositories(giteaId);
				return repositories;
			} catch (error) {
				console.error("Error fetching Gitea repositories:", error);
				throw new BadRequestError(
					error instanceof Error ? error.message : String(error),
				);
			}
		}

		case GiteaMethod.getGiteaBranches: {
			const input = decodeArgs<{
				giteaId: string;
				owner: string;
				repositoryName: string;
			}>(call.payload);
			const { giteaId, owner, repositoryName } = input;

			if (!giteaId || !owner || !repositoryName) {
				throw new BadRequestError(
					"Gitea provider ID, owner, and repository name are required.",
				);
			}

			try {
				return await getGiteaBranches({
					giteaId,
					owner,
					repo: repositoryName,
				});
			} catch (error) {
				console.error("Error fetching Gitea branches:", error);
				throw new BadRequestError(
					error instanceof Error ? error.message : String(error),
				);
			}
		}

		case GiteaMethod.testConnection: {
			const input = decodeArgs<{ giteaId?: string }>(call.payload);
			const giteaId = input.giteaId ?? "";

			try {
				const result = await testGiteaConnection({
					giteaId,
				});

				return `Found ${result} repositories`;
			} catch (error) {
				console.error("Gitea connection test error:", error);
				throw new BadRequestError(
					error instanceof Error ? error.message : String(error),
				);
			}
		}

		case GiteaMethod.update: {
			// biome-ignore lint/suspicious/noExplicitAny: apiUpdateGitea input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			if (input.name) {
				await updateGitProvider(input.gitProviderId, {
					name: input.name,
					organizationId: ctx.session.activeOrganizationId,
				});

				await updateGitea(input.giteaId, {
					...input,
				});
			} else {
				await updateGitea(input.giteaId, {
					...input,
				});
			}

			console.info("[audit] gitea.update", {
				action: "update",
				resourceType: "gitProvider",
				resourceId: input.giteaId,
				resourceName: input.name,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.session.userId,
			});

			return { success: true };
		}

		case GiteaMethod.getGiteaUrl: {
			const input = decodeArgs<{ giteaId: string }>(call.payload);
			const { giteaId } = input;

			if (!giteaId) {
				throw new BadRequestError("Gitea provider ID is required.");
			}

			const giteaProvider = await findGiteaById(giteaId);

			// Return the base URL of the Gitea instance
			return giteaProvider.giteaUrl;
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
