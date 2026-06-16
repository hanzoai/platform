// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// bitbucket-cap.ts — the native @zap-proto/web Bitbucket capability.
//
// Binary-ZAP replacement for the tRPC `bitbucketRouter`
// (server/api/routers/bitbucket.ts). `create` and `update` were
// `withPermission("gitProviders", "create")`; the rest were
// `protectedProcedure` — both reduce to an authenticated caller (session+user)
// on this branch. The mint boundary requires session+user (a null return
// rejects the WS upgrade with HTTP 401, mirroring protectedProcedure); the
// per-org filtering in `bitbucketProviders` is enforced INSIDE dispatch,
// verbatim from the original procedure body. Inputs ride the shared Args
// carrier, results the shared Result carrier; BitbucketMethod ordinals are
// generated from bitbucket.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// bitbucket.<action>", …)`, mirroring how registry-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
// PRE-EXISTING: `getAccessibleGitProviderIds` is not exported by the Hanzo fork
// (per-user provider ACL dropped); the old router
// server/api/routers/bitbucket.ts:4 imports it identically. Provider access is
// scoped by the org id.
import {
	createBitbucket,
	findBitbucketById,
	getBitbucketBranches,
	getBitbucketRepositories,
	testBitbucketConnection,
	updateBitbucket,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { BitbucketMethod } from "./schema/bitbucket_zap";

/**
 * Per-connection auth context — the tRPC ctx shape the ported bodies expect:
 * `ctx.session.activeOrganizationId` / `ctx.session.userId` (the
 * getAccessibleGitProviderIds + create/audit fields).
 */
export interface BitbucketCtx {
	session: { activeOrganizationId: string; userId: string };
}

/**
 * bitbucketMintCap — bearer→ctx boundary. Mirrors `protectedProcedure` /
 * `withPermission("gitProviders", …)`'s authentication half: validates the
 * upgrade and requires session+user. Null → HTTP 401 before any socket opens.
 * The per-org filtering half runs inside dispatch (verbatim from the bodies).
 */
export const bitbucketMintCap: MintCap<BitbucketCtx> = async (
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
 * bitbucketRootCap — dispatch each decoded Call by BitbucketMethod ordinal to the
 * same service functions the tRPC procedure called. Inputs decode via the shared
 * Args carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function bitbucketRootCap(ctx: BitbucketCtx): CallHandler {
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

async function dispatch(ctx: BitbucketCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case BitbucketMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: apiCreateBitbucket input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			try {
				const result = await createBitbucket(
					input,
					ctx.session.activeOrganizationId,
					ctx.session.userId,
				);

				console.info("[audit] bitbucket.create", {
					action: "create",
					resourceType: "gitProvider",
					resourceName: input.name,
					organizationId: ctx.session.activeOrganizationId,
					userId: ctx.session.userId,
				});

				return result;
			} catch (error) {
				throw new BadRequestError("Error creating this Bitbucket provider");
			}
		}

		case BitbucketMethod.one: {
			const input = decodeArgs<{ bitbucketId: string }>(call.payload);
			return await findBitbucketById(input.bitbucketId);
		}

		case BitbucketMethod.bitbucketProviders: {
			let result = await db.query.bitbucket.findMany({
				with: {
					gitProvider: true,
				},
				columns: {
					bitbucketId: true,
				},
			});

			// PRE-EXISTING: per-user accessible-id filter dropped in the fork;
			// scope by org directly (mirrors doks-cap org-ownership).
			result = result.filter((provider) => {
				return (
					provider.gitProvider.organizationId ===
					ctx.session.activeOrganizationId
				);
			});
			return result;
		}

		case BitbucketMethod.getBitbucketRepositories: {
			const input = decodeArgs<{ bitbucketId: string }>(call.payload);
			return await getBitbucketRepositories(input.bitbucketId);
		}

		case BitbucketMethod.getBitbucketBranches: {
			// biome-ignore lint/suspicious/noExplicitAny: apiFindBitbucketBranches input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			return await getBitbucketBranches(input);
		}

		case BitbucketMethod.testConnection: {
			// biome-ignore lint/suspicious/noExplicitAny: apiBitbucketTestConnection input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			try {
				const result = await testBitbucketConnection(input);

				return `Found ${result} repositories`;
			} catch (error) {
				throw new BadRequestError(
					error instanceof Error ? error?.message : `Error: ${error}`,
				);
			}
		}

		case BitbucketMethod.update: {
			// biome-ignore lint/suspicious/noExplicitAny: apiUpdateBitbucket input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			const result = await updateBitbucket(input.bitbucketId, {
				...input,
				organizationId: ctx.session.activeOrganizationId,
			});

			console.info("[audit] bitbucket.update", {
				action: "update",
				resourceType: "gitProvider",
				resourceId: input.bitbucketId,
				resourceName: input.name,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.session.userId,
			});

			return result;
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
