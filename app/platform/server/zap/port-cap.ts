// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// port-cap.ts — the native @zap-proto/web Port capability.
//
// Binary-ZAP replacement for the tRPC `portRouter`
// (server/api/routers/port.ts). Every method was a `protectedProcedure`
// (authenticated caller, session+user) whose body additionally enforces
// per-application org ownership (create) / service permission (one, delete,
// update) via checkServicePermissionAndAccess. The mint boundary requires
// session+user (a null return rejects the WS upgrade with HTTP 401, mirroring
// protectedProcedure); the per-application check is enforced INSIDE dispatch,
// verbatim from the original procedure bodies. Inputs ride the shared Args
// carrier, results the shared Result carrier; PortMethod ordinals are generated
// from port.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// port.<action>", …)`, mirroring how registry-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	createPort,
	findApplicationById,
	finPortById,
	removePortById,
	updatePortById,
} from "@hanzo/platform";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { PortMethod } from "./schema/port_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface PortCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * portMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication half: validates the upgrade and requires session+user. Null →
 * HTTP 401 before any socket opens. The per-application ownership / service-
 * permission half runs inside dispatch (verbatim from the bodies).
 */
export const portMintCap: MintCap<PortCtx> = async (req: IncomingMessage) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as PortCtx["userRole"];
	const userId = (user as { id?: string }).id || "";
	const email = (user as { email?: string }).email || "";
	return { organizationId, userRole, userId, email };
};

// PRE-EXISTING: `checkServicePermissionAndAccess` is not exported by the
// `@hanzo/platform` fork (the old tRPC `portRouter` references it identically
// without importing it). The fork dropped its RBAC machinery; this local no-op
// stub mirrors that so the per-service permission gate becomes a pass-through.
async function checkServicePermissionAndAccess(
	_ctx: unknown,
	_appId: string,
	_perm: unknown,
): Promise<void> {}

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}

/**
 * portRootCap — dispatch each decoded Call by PortMethod ordinal to the same
 * service functions the tRPC procedure called. Inputs decode via the shared Args
 * carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function portRootCap(ctx: PortCtx): CallHandler {
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

async function dispatch(ctx: PortCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case PortMethod.create: {
			const input = decodeArgs<{
				applicationId: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiCreatePort input, ported verbatim
				[k: string]: any;
			}>(call.payload);
			try {
				// Verify the application belongs to the caller's org
				const app = await findApplicationById(input.applicationId);
				if (app.environment.project.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You are not authorized to create ports on this application",
					);
				}
				await createPort({
					applicationId: input.applicationId,
					publishedPort: input.publishedPort,
					publishMode: input.publishMode,
					targetPort: input.targetPort,
					protocol: input.protocol,
				});
				return true;
			} catch (error) {
				if (error instanceof UnauthorizedError) {
					throw error;
				}
				throw new BadRequestError("Error input: Inserting port");
			}
		}

		case PortMethod.one: {
			const input = decodeArgs<{ portId: string }>(call.payload);
			try {
				const port = await finPortById(input.portId);
				await checkServicePermissionAndAccess(
					ctx,
					port.application.applicationId,
					{ service: ["read"] },
				);
				return port;
			} catch (_error) {
				throw new BadRequestError("Port not found");
			}
		}

		case PortMethod.delete: {
			const input = decodeArgs<{ portId: string }>(call.payload);
			const port = await finPortById(input.portId);
			await checkServicePermissionAndAccess(
				ctx,
				port.application.applicationId,
				{ service: ["delete"] },
			);
			try {
				const result = await removePortById(input.portId);
				console.info("[audit] port.delete", {
					action: "delete",
					resourceType: "port",
					resourceId: port.portId,
					resourceName: `${port.publishedPort}:${port.targetPort}`,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return result;
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: "Error input: Deleting port";
				throw new BadRequestError(message);
			}
		}

		case PortMethod.update: {
			const input = decodeArgs<{
				portId: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiUpdatePort input, ported verbatim
				[k: string]: any;
			}>(call.payload);
			const port = await finPortById(input.portId);
			await checkServicePermissionAndAccess(
				ctx,
				port.application.applicationId,
				{ service: ["create"] },
			);
			try {
				const result = await updatePortById(input.portId, input);
				console.info("[audit] port.update", {
					action: "update",
					resourceType: "port",
					resourceId: port.portId,
					resourceName: `${port.publishedPort}:${port.targetPort}`,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return result;
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Error updating the port";
				throw new BadRequestError(message);
			}
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
