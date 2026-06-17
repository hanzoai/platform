// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// ssh-key-cap.ts — the native @zap-proto/web SshKey capability.
//
// Binary-ZAP replacement for the tRPC `sshRouter`
// (server/api/routers/ssh-key.ts). Every method was either
// `withPermission("sshKeys", <action>)` or a bare `protectedProcedure`
// (allForApps) — an authenticated caller (session+user) whose body additionally
// enforces per-key org ownership. The mint boundary requires session+user (a
// null return rejects the WS upgrade with HTTP 401, mirroring protectedProcedure);
// the per-key ownership check is enforced INSIDE dispatch, verbatim from the
// original procedure bodies. Inputs ride the shared Args carrier, results the
// shared Result carrier; SshKeyMethod ordinals are generated from ssh-key.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// sshKey.<action>", …)`, mirroring how registry-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	createSshKey,
	findSSHKeyById,
	generateSSHKey,
	removeSSHKeyById,
	updateSSHKeyById,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { desc, eq } from "drizzle-orm";
import { sshKeys } from "@/server/db/schema";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { SshKeyMethod } from "./schema/ssh-key_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface SshKeyCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * sshKeyMintCap — bearer→ctx boundary. Mirrors `withPermission("sshKeys", …)`'s
 * authentication half (a `protectedProcedure` base): validates the upgrade and
 * requires session+user. Null → HTTP 401 before any socket opens. The per-key
 * org-ownership half runs inside dispatch (verbatim from the bodies).
 */
export const sshKeyMintCap: MintCap<SshKeyCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as SshKeyCtx["userRole"];
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
 * sshKeyRootCap — dispatch each decoded Call by SshKeyMethod ordinal to the same
 * service functions the tRPC procedure called. Inputs decode via the shared Args
 * carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function sshKeyRootCap(ctx: SshKeyCtx): CallHandler {
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

async function dispatch(ctx: SshKeyCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case SshKeyMethod.create: {
			const input = decodeArgs<{
				name: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiCreateSshKey input, ported verbatim
				[k: string]: any;
				// biome-ignore lint/suspicious/noExplicitAny: spread into createSshKey, ported verbatim
			}>(call.payload) as any;
			try {
				await createSshKey({
					...input,
					organizationId: ctx.organizationId,
				});
				console.info("[audit] sshKey.create", {
					action: "create",
					resourceType: "sshKey",
					resourceName: input.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return true;
			} catch (error) {
				throw new BadRequestError("Error creating the SSH key");
			}
		}

		case SshKeyMethod.remove: {
			const input = decodeArgs<{ sshKeyId: string }>(call.payload);
			try {
				const sshKey = await findSSHKeyById(input.sshKeyId);
				if (sshKey.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You are not allowed to delete this SSH key",
					);
				}

				console.info("[audit] sshKey.delete", {
					action: "delete",
					resourceType: "sshKey",
					resourceId: sshKey.sshKeyId,
					resourceName: sshKey.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return await removeSSHKeyById(input.sshKeyId);
			} catch (error) {
				throw error;
			}
		}

		case SshKeyMethod.one: {
			const input = decodeArgs<{ sshKeyId: string }>(call.payload);
			const sshKey = await findSSHKeyById(input.sshKeyId);

			if (sshKey.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not allowed to access this SSH key",
				);
			}
			return sshKey;
		}

		case SshKeyMethod.all: {
			return await db.query.sshKeys.findMany({
				where: eq(sshKeys.organizationId, ctx.organizationId),
				orderBy: desc(sshKeys.createdAt),
			});
		}

		case SshKeyMethod.allForApps: {
			return await db.query.sshKeys.findMany({
				columns: {
					sshKeyId: true,
					name: true,
				},
				where: eq(sshKeys.organizationId, ctx.organizationId),
				orderBy: desc(sshKeys.createdAt),
			});
		}

		case SshKeyMethod.generate: {
			const input = decodeArgs<{ type: Parameters<typeof generateSSHKey>[0] }>(
				call.payload,
			);
			return await generateSSHKey(input.type);
		}

		case SshKeyMethod.update: {
			const input = decodeArgs<{
				sshKeyId: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiUpdateSshKey input, ported verbatim
				[k: string]: any;
			}>(call.payload);
			try {
				const sshKey = await findSSHKeyById(input.sshKeyId);
				if (sshKey.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You are not allowed to update this SSH key",
					);
				}
				const result = await updateSSHKeyById(input);
				console.info("[audit] sshKey.update", {
					action: "update",
					resourceType: "sshKey",
					resourceId: sshKey.sshKeyId,
					resourceName: sshKey.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return result;
			} catch (error) {
				throw new BadRequestError("Error updating this SSH key");
			}
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
