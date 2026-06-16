// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// deploy-provider-cap.ts — the native @zap-proto/web DeployProvider capability.
//
// Binary-ZAP replacement for the tRPC `deployProviderRouter`
// (server/api/routers/deploy-provider.ts). `create`/`update`/`remove` were
// `adminProcedure`; `one`/`all`/`testConnection` were `protectedProcedure` — an
// authenticated caller (session+user) whose body additionally enforces
// per-provider org ownership inside the service functions. The mint boundary
// requires session+user (a null return rejects the WS upgrade with HTTP 401,
// mirroring protectedProcedure); the per-provider org scoping runs INSIDE
// dispatch, verbatim from the original procedure bodies. Inputs ride the shared
// Args carrier, results the shared Result carrier; DeployProviderMethod ordinals
// are generated from deploy-provider.zap.
//
// The source procedures wrapped service errors in `TRPCError({ code:
// "BAD_REQUEST" })`; those map here to the typed BadRequestError → ZAP
// Status.BadRequest. The source declared no `audit(ctx, …)` side effect, so none
// is recorded here.

import type { IncomingMessage } from "node:http";
import {
	createDeployProvider,
	findDeployProviderById,
	findDeployProvidersByOrg,
	removeDeployProviderById,
	testDeployProviderConnection,
	updateDeployProviderById,
} from "@hanzo/platform-server/services/deploy-provider";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { DeployProviderMethod } from "./schema/deploy-provider_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface DeployProviderCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * deployProviderMintCap — bearer→ctx boundary. Mirrors the procedures'
 * authentication half (a `protectedProcedure` base): validates the upgrade and
 * requires session+user. Null → HTTP 401 before any socket opens. The
 * per-provider org scoping runs inside dispatch (verbatim from the bodies).
 */
export const deployProviderMintCap: MintCap<DeployProviderCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as DeployProviderCtx["userRole"];
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
 * deployProviderRootCap — dispatch each decoded Call by DeployProviderMethod
 * ordinal to the same service functions the tRPC procedure called. Inputs decode
 * via the shared Args carrier; results encode via the shared Result carrier.
 * Errors map to ZAP status codes (mirroring the tRPC error codes), never a thrown
 * HTTP 500 leak.
 */
export function deployProviderRootCap(ctx: DeployProviderCtx): CallHandler {
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

async function dispatch(
	ctx: DeployProviderCtx,
	call: Call,
): Promise<unknown> {
	switch (call.method) {
		case DeployProviderMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: apiCreateDeployProvider input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			try {
				return await createDeployProvider(input, ctx.organizationId);
			} catch (error) {
				throw new BadRequestError(
					error instanceof Error
						? error.message
						: "Failed to create deploy provider",
				);
			}
		}

		case DeployProviderMethod.one: {
			const input = decodeArgs<{ deployProviderId: string }>(call.payload);
			return findDeployProviderById(input.deployProviderId);
		}

		case DeployProviderMethod.all: {
			return findDeployProvidersByOrg(ctx.organizationId);
		}

		case DeployProviderMethod.update: {
			const input = decodeArgs<{
				deployProviderId: string;
				[k: string]: unknown;
				// biome-ignore lint/suspicious/noExplicitAny: apiUpdateDeployProvider input, ported verbatim
			}>(call.payload) as any;
			const { deployProviderId, ...data } = input;
			try {
				return await updateDeployProviderById(
					deployProviderId,
					ctx.organizationId,
					data,
				);
			} catch (error) {
				throw new BadRequestError(
					error instanceof Error
						? error.message
						: "Failed to update deploy provider",
				);
			}
		}

		case DeployProviderMethod.remove: {
			const input = decodeArgs<{ deployProviderId: string }>(call.payload);
			try {
				await removeDeployProviderById(
					input.deployProviderId,
					ctx.organizationId,
				);
				return { success: true };
			} catch (error) {
				throw new BadRequestError(
					error instanceof Error
						? error.message
						: "Failed to remove deploy provider",
				);
			}
		}

		case DeployProviderMethod.testConnection: {
			const input = decodeArgs<{ deployProviderId: string }>(call.payload);
			const provider = await findDeployProviderById(input.deployProviderId);
			return testDeployProviderConnection(provider);
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
