// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// destination-cap.ts — the native @zap-proto/web Destination capability.
//
// Binary-ZAP replacement for the tRPC `destinationRouter`
// (server/api/routers/destination.ts). Every method was
// `withPermission("destination", <action>)` — an authenticated caller
// (session+user) whose body additionally enforces per-destination org
// ownership. The mint boundary requires session+user (a null return rejects the
// WS upgrade with HTTP 401, mirroring protectedProcedure); the per-destination
// ownership check is enforced INSIDE dispatch, verbatim from the original
// procedure bodies. Inputs ride the shared Args carrier, results the shared
// Result carrier; DestinationMethod ordinals are generated from destination.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// destination.<action>", …)`, mirroring how cluster-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	createDestintation,
	execAsync,
	execAsyncRemote,
	findDestinationById,
	IS_CLOUD,
	removeDestinationById,
	updateDestinationById,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { desc, eq } from "drizzle-orm";
import { destinations } from "@/server/db/schema";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { DestinationMethod } from "./schema/destination_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface DestinationCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * destinationMintCap — bearer→ctx boundary. Mirrors
 * `withPermission("destination", …)`'s authentication half (a
 * `protectedProcedure` base): validates the upgrade and requires session+user.
 * Null → HTTP 401 before any socket opens. The per-destination org-ownership
 * half runs inside dispatch (verbatim from the bodies).
 */
export const destinationMintCap: MintCap<DestinationCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as DestinationCtx["userRole"];
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
 * destinationRootCap — dispatch each decoded Call by DestinationMethod ordinal
 * to the same service functions the tRPC procedure called. Inputs decode via the
 * shared Args carrier; results encode via the shared Result carrier. Errors map
 * to ZAP status codes (mirroring the tRPC error codes), never a thrown HTTP 500
 * leak.
 */
export function destinationRootCap(ctx: DestinationCtx): CallHandler {
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

async function dispatch(ctx: DestinationCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case DestinationMethod.create: {
			const input = decodeArgs<{
				name: string;
				serverId?: string;
				[k: string]: unknown;
				// biome-ignore lint/suspicious/noExplicitAny: apiCreateDestination input, ported verbatim
			}>(call.payload) as any;
			try {
				const result = await createDestintation(input, ctx.organizationId);
				console.info("[audit] destination.create", {
					action: "create",
					resourceType: "destination",
					resourceId: result.destinationId,
					resourceName: input.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return result;
			} catch (error) {
				throw new BadRequestError(
					error instanceof Error
						? error.message
						: "Error creating the destination",
				);
			}
		}

		case DestinationMethod.testConnection: {
			const input = decodeArgs<{
				secretAccessKey: string;
				bucket: string;
				region: string;
				endpoint: string;
				accessKey: string;
				provider?: string;
				additionalFlags?: string[];
				serverId?: string;
			}>(call.payload);
			const {
				secretAccessKey,
				bucket,
				region,
				endpoint,
				accessKey,
				provider,
				additionalFlags,
			} = input;
			try {
				const rcloneFlags = [
					`--s3-access-key-id="${accessKey}"`,
					`--s3-secret-access-key="${secretAccessKey}"`,
					`--s3-region="${region}"`,
					`--s3-endpoint="${endpoint}"`,
					"--s3-no-check-bucket",
					"--s3-force-path-style",
					"--retries 1",
					"--low-level-retries 1",
					"--timeout 10s",
					"--contimeout 5s",
				];
				if (provider) {
					rcloneFlags.unshift(`--s3-provider="${provider}"`);
				}
				if (additionalFlags?.length) {
					rcloneFlags.push(...additionalFlags);
				}
				const rcloneDestination = `:s3:${bucket}`;
				const rcloneCommand = `rclone ls ${rcloneFlags.join(" ")} "${rcloneDestination}"`;

				if (IS_CLOUD && !input.serverId) {
					throw new NotFoundError("Server not found");
				}

				if (IS_CLOUD) {
					await execAsyncRemote(input.serverId || "", rcloneCommand);
				} else {
					await execAsync(rcloneCommand);
				}
				return undefined;
			} catch (error) {
				if (error instanceof NotFoundError) throw error;
				throw new BadRequestError(
					error instanceof Error
						? error?.message
						: "Error connecting to bucket",
				);
			}
		}

		case DestinationMethod.one: {
			const input = decodeArgs<{ destinationId: string }>(call.payload);
			const destination = await findDestinationById(input.destinationId);
			if (destination.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not allowed to access this destination",
				);
			}
			return destination;
		}

		case DestinationMethod.all: {
			return await db.query.destinations.findMany({
				where: eq(destinations.organizationId, ctx.organizationId),
				orderBy: [desc(destinations.createdAt)],
			});
		}

		case DestinationMethod.remove: {
			const input = decodeArgs<{ destinationId: string }>(call.payload);
			const destination = await findDestinationById(input.destinationId);

			if (destination.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not allowed to delete this destination",
				);
			}
			const result = await removeDestinationById(
				input.destinationId,
				ctx.organizationId,
			);
			console.info("[audit] destination.delete", {
				action: "delete",
				resourceType: "destination",
				resourceId: input.destinationId,
				resourceName: destination.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return result;
		}

		case DestinationMethod.update: {
			const input = decodeArgs<{
				destinationId: string;
				name?: string;
				[k: string]: unknown;
				// biome-ignore lint/suspicious/noExplicitAny: apiUpdateDestination input, ported verbatim
			}>(call.payload) as any;
			try {
				const destination = await findDestinationById(input.destinationId);
				if (destination.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You are not allowed to update this destination",
					);
				}
				const result = await updateDestinationById(input.destinationId, {
					...input,
					organizationId: ctx.organizationId,
				});
				console.info("[audit] destination.update", {
					action: "update",
					resourceType: "destination",
					resourceId: input.destinationId,
					resourceName: input.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return result;
			} catch (error) {
				if (error instanceof UnauthorizedError) throw error;
				throw new BadRequestError(
					error instanceof Error
						? error?.message
						: "Error connecting to bucket",
				);
			}
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
