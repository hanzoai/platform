// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// github-cap.ts — the native @zap-proto/web Github capability.
//
// Binary-ZAP replacement for the tRPC `githubRouter`
// (server/api/routers/github.ts). Every read method was a `protectedProcedure`
// (authenticated caller, session+user); `update` was
// `withPermission("gitProviders", "create")` whose body is likewise just an
// authenticated caller (no extra in-body permission check). The mint boundary
// requires session+user (a null return rejects the WS upgrade with HTTP 401,
// mirroring protectedProcedure); the per-provider org-ownership check on
// getGithubBranches is enforced INSIDE dispatch, verbatim from the original
// procedure body. Inputs ride the shared Args carrier, results the shared Result
// carrier; GithubMethod ordinals are generated from github.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// github.<action>", …)`, mirroring how registry-cap.ts ported its audit. (The
// github router itself does not call audit, so none appears here.)

import type { IncomingMessage } from "node:http";
// PRE-EXISTING: `getAccessibleGitProviderIds` is not exported by the Hanzo fork
// (per-user provider ACL dropped); the old router server/api/routers/github.ts:3
// imports it identically. Provider access is scoped by `ctx.organizationId`.
import {
	findGithubById,
	getGithubBranches,
	getGithubRepositories,
	haveGithubRequirements,
	updateGithub,
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
import { GithubMethod } from "./schema/github_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface GithubCtx {
	organizationId: string;
	userId: string;
}

/**
 * githubMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication half: validates the upgrade and requires session+user. Null →
 * HTTP 401 before any socket opens. The per-provider org-ownership half runs
 * inside dispatch (verbatim from the bodies).
 */
export const githubMintCap: MintCap<GithubCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userId = (user as { id?: string }).id || "";
	return { organizationId, userId };
};

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}

/**
 * githubRootCap — dispatch each decoded Call by GithubMethod ordinal to the same
 * service functions the tRPC procedure called. Inputs decode via the shared Args
 * carrier; results encode via the shared Result carrier. Errors map to ZAP status
 * codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function githubRootCap(ctx: GithubCtx): CallHandler {
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

async function dispatch(ctx: GithubCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case GithubMethod.one: {
			const input = decodeArgs<{ githubId: string }>(call.payload);
			return await findGithubById(input.githubId);
		}

		case GithubMethod.getGithubRepositories: {
			const input = decodeArgs<{ githubId: string }>(call.payload);
			return await getGithubRepositories(input.githubId);
		}

		case GithubMethod.getGithubBranches: {
			const input = decodeArgs<{
				repo: string;
				owner: string;
				githubId?: string;
			}>(call.payload);
			const githubProvider = await findGithubById(input.githubId || "");
			if (
				githubProvider.gitProvider.organizationId !== ctx.organizationId &&
				githubProvider.gitProvider.userId === ctx.userId
			) {
				throw new UnauthorizedError(
					"You are not allowed to access this github provider",
				);
			}
			return await getGithubBranches(input);
		}

		case GithubMethod.githubProviders: {
			let result = await db.query.github.findMany({
				with: {
					gitProvider: true,
				},
			});

			// PRE-EXISTING: per-user accessible-id filter dropped in the fork;
			// scope by org directly (mirrors doks-cap org-ownership).
			result = result.filter(
				(provider) =>
					provider.gitProvider.organizationId === ctx.organizationId,
			);

			const filtered = result
				.filter((provider) => haveGithubRequirements(provider))
				.map((provider) => {
					return {
						githubId: provider.githubId,
						gitProvider: {
							...provider.gitProvider,
						},
					};
				});

			return filtered;
		}

		case GithubMethod.testConnection: {
			const input = decodeArgs<{ githubId: string }>(call.payload);
			try {
				const result = await getGithubRepositories(input.githubId);
				return `Found ${result.length} repositories`;
			} catch (err) {
				throw new BadRequestError(
					err instanceof Error ? err?.message : `Error: ${err}`,
				);
			}
		}

		case GithubMethod.update: {
			const input = decodeArgs<{
				gitProviderId: string;
				githubId: string;
				name?: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiUpdateGithub input, ported verbatim
				[k: string]: any;
			}>(call.payload);
			await updateGitProvider(input.gitProviderId, {
				name: input.name,
				organizationId: ctx.organizationId,
			});

			await updateGithub(input.githubId, {
				...input,
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim from tRPC body
			} as any);
			return undefined;
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
