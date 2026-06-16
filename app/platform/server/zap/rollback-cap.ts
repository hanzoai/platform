// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// rollback-cap.ts — the native @zap-proto/web Rollback capability.
//
// Binary-ZAP replacement for the tRPC `rollbackRouter`
// (server/api/routers/rollbacks.ts). Both methods were `protectedProcedure`
// mutations (authenticated caller, session+user) whose body additionally
// enforces per-rollback org ownership (delete) / service permission (rollback)
// via checkServicePermissionAndAccess. The mint boundary requires session+user
// (a null return rejects the WS upgrade with HTTP 401, mirroring
// protectedProcedure); the per-rollback check is enforced INSIDE dispatch,
// verbatim from the original procedure bodies. Inputs ride the shared Args
// carrier, results the shared Result carrier; RollbackMethod ordinals are
// generated from rollback.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// rollback.<action>", …)`, mirroring how port-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	checkServicePermissionAndAccess,
	findRollbackById,
	removeRollbackById,
	rollback,
} from "@hanzo/platform";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { RollbackMethod } from "./schema/rollback_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface RollbackCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * rollbackMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication half: validates the upgrade and requires session+user. Null →
 * HTTP 401 before any socket opens. The per-rollback ownership / service-
 * permission half runs inside dispatch (verbatim from the bodies).
 */
export const rollbackMintCap: MintCap<RollbackCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as RollbackCtx["userRole"];
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
 * rollbackRootCap — dispatch each decoded Call by RollbackMethod ordinal to the
 * same service functions the tRPC procedure called. Inputs decode via the shared
 * Args carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function rollbackRootCap(ctx: RollbackCtx): CallHandler {
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

async function dispatch(ctx: RollbackCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case RollbackMethod.delete: {
			const input = decodeArgs<{ rollbackId: string }>(call.payload);
			try {
				const currentRollback = await findRollbackById(input.rollbackId);
				if (
					currentRollback?.deployment?.application?.environment?.project
						.organizationId !== ctx.organizationId
				) {
					throw new UnauthorizedError(
						"You are not authorized to delete this rollback",
					);
				}
				return removeRollbackById(input.rollbackId);
			} catch (error) {
				if (error instanceof UnauthorizedError) {
					throw error;
				}
				const message =
					error instanceof Error
						? error.message
						: "Error input: Deleting rollback";
				throw new BadRequestError(message);
			}
		}

		case RollbackMethod.rollback: {
			const input = decodeArgs<{ rollbackId: string }>(call.payload);
			try {
				const rb = await findRollbackById(input.rollbackId);
				const serviceId = rb.deployment.applicationId;
				if (serviceId) {
					await checkServicePermissionAndAccess(ctx, serviceId, {
						deployment: ["create"],
					});
				}
				const result = await rollback(input.rollbackId);
				console.info("[audit] rollback.rollback", {
					action: "restore",
					resourceType: "deployment",
					resourceId: input.rollbackId,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return result;
			} catch (error) {
				console.error(error);
				throw new BadRequestError("Error input: Rolling back");
			}
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
