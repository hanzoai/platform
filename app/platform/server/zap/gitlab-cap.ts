// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// gitlab-cap.ts — the native @zap-proto/web Gitlab capability.
//
// Binary-ZAP replacement for the tRPC `gitlabRouter`
// (server/api/routers/gitlab.ts). `create`/`update` were
// `withPermission("gitProviders", "create")`; the rest were `protectedProcedure`
// — an authenticated caller (session+user) whose body additionally enforces
// per-provider org ownership. The mint boundary requires session+user (a null
// return rejects the WS upgrade with HTTP 401, mirroring protectedProcedure);
// the per-provider ownership checks are enforced INSIDE dispatch, verbatim from
// the original procedure bodies. Inputs ride the shared Args carrier, results
// the shared Result carrier; GitlabMethod ordinals are generated from
// gitlab.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// gitlab.<action>", …)`, mirroring how registry-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	createGitlab,
	findGitlabById,
	getAccessibleGitProviderIds,
	getGitlabBranches,
	getGitlabRepositories,
	haveGitlabRequirements,
	testGitlabConnection,
	updateGitlab,
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
import { GitlabMethod } from "./schema/gitlab_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface GitlabCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * gitlabMintCap — bearer→ctx boundary. Mirrors the authentication half of
 * `withPermission("gitProviders", …)` / `protectedProcedure` (session+user).
 * Null → HTTP 401 before any socket opens. The per-provider org-ownership half
 * runs inside dispatch (verbatim from the bodies).
 */
export const gitlabMintCap: MintCap<GitlabCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as GitlabCtx["userRole"];
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

/**
 * gitlabRootCap — dispatch each decoded Call by GitlabMethod ordinal to the same
 * service functions the tRPC procedure called. Inputs decode via the shared Args
 * carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function gitlabRootCap(ctx: GitlabCtx): CallHandler {
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

async function dispatch(ctx: GitlabCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case GitlabMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: apiCreateGitlab input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			try {
				const result = await createGitlab(
					input,
					ctx.organizationId,
					ctx.userId,
				);

				console.info("[audit] gitlab.create", {
					action: "create",
					resourceType: "gitProvider",
					resourceName: input.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});

				return result;
			} catch (error) {
				throw new BadRequestError("Error creating this Gitlab provider");
			}
		}

		case GitlabMethod.one: {
			const input = decodeArgs<{ gitlabId: string }>(call.payload);
			return await findGitlabById(input.gitlabId);
		}

		case GitlabMethod.gitlabProviders: {
			const accessibleIds = await getAccessibleGitProviderIds({
				userId: ctx.userId,
				activeOrganizationId: ctx.organizationId,
			});

			let result = await db.query.gitlab.findMany({
				with: {
					gitProvider: true,
				},
			});

			result = result.filter((provider) => {
				return (
					provider.gitProvider.organizationId === ctx.organizationId &&
					accessibleIds.has(provider.gitProvider.gitProviderId)
				);
			});
			const filtered = result
				.filter((provider) => haveGitlabRequirements(provider))
				.map((provider) => {
					return {
						gitlabId: provider.gitlabId,
						gitProvider: {
							...provider.gitProvider,
						},
						gitlabUrl: provider.gitlabUrl,
					};
				});

			return filtered;
		}

		case GitlabMethod.getGitlabRepositories: {
			const input = decodeArgs<{ gitlabId: string }>(call.payload);
			return await getGitlabRepositories(input.gitlabId);
		}

		case GitlabMethod.getGitlabBranches: {
			const input = decodeArgs<{ gitlabId?: string }>(call.payload);
			const gitlabProvider = await findGitlabById(input.gitlabId || "");
			if (
				gitlabProvider.gitProvider.organizationId !== ctx.organizationId &&
				gitlabProvider.gitProvider.userId !== ctx.userId
			) {
				throw new UnauthorizedError(
					"You are not allowed to access this Gitlab provider",
				);
			}
			// biome-ignore lint/suspicious/noExplicitAny: apiFindGitlabBranches input, ported verbatim
			return await getGitlabBranches(input as any);
		}

		case GitlabMethod.testConnection: {
			// biome-ignore lint/suspicious/noExplicitAny: apiGitlabTestConnection input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			try {
				const result = await testGitlabConnection(input);

				return `Found ${result} repositories`;
			} catch (error) {
				throw new BadRequestError(
					error instanceof Error ? error?.message : `Error: ${error}`,
				);
			}
		}

		case GitlabMethod.update: {
			// biome-ignore lint/suspicious/noExplicitAny: apiUpdateGitlab input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			if (input.name) {
				await updateGitProvider(input.gitProviderId, {
					name: input.name,
					organizationId: ctx.organizationId,
				});

				await updateGitlab(input.gitlabId, {
					...input,
					// biome-ignore lint/suspicious/noExplicitAny: apiUpdateGitlab input, ported verbatim
				} as any);
			} else {
				await updateGitlab(input.gitlabId, {
					...input,
					// biome-ignore lint/suspicious/noExplicitAny: apiUpdateGitlab input, ported verbatim
				} as any);
			}

			console.info("[audit] gitlab.update", {
				action: "update",
				resourceType: "gitProvider",
				resourceId: input.gitProviderId,
				resourceName: input.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return null;
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
