// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// registry-cap.ts — the native @zap-proto/web Registry capability.
//
// Binary-ZAP replacement for the tRPC `registryRouter`
// (server/api/routers/registry.ts). Every method was
// `withPermission("registry", <action>)` — an authenticated caller (session+
// user) whose body additionally enforces per-registry org ownership. The mint
// boundary requires session+user (a null return rejects the WS upgrade with
// HTTP 401, mirroring protectedProcedure); the per-registry ownership check is
// enforced INSIDE dispatch, verbatim from the original procedure bodies. Inputs
// ride the shared Args carrier, results the shared Result carrier;
// RegistryMethod ordinals are generated from registry.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// registry.<action>", …)`, mirroring how cluster-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	createRegistry,
	execAsyncRemote,
	execFileAsync,
	findRegistryById,
	IS_CLOUD,
	removeRegistry,
	updateRegistry,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { eq } from "drizzle-orm";
import { registry } from "@/server/db/schema";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { RegistryMethod } from "./schema/registry_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface RegistryCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * registryMintCap — bearer→ctx boundary. Mirrors `withPermission("registry",
 * …)`'s authentication half (a `protectedProcedure` base): validates the upgrade
 * and requires session+user. Null → HTTP 401 before any socket opens. The
 * per-registry org-ownership half runs inside dispatch (verbatim from the
 * bodies).
 */
export const registryMintCap: MintCap<RegistryCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as RegistryCtx["userRole"];
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
 * registryRootCap — dispatch each decoded Call by RegistryMethod ordinal to the
 * same service functions the tRPC procedure called. Inputs decode via the shared
 * Args carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function registryRootCap(ctx: RegistryCtx): CallHandler {
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

async function dispatch(ctx: RegistryCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case RegistryMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: apiCreateRegistry input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			const reg = await createRegistry(input, ctx.organizationId);
			console.info("[audit] registry.create", {
				action: "create",
				resourceType: "registry",
				resourceId: reg.registryId,
				resourceName: reg.registryName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return reg;
		}

		case RegistryMethod.remove: {
			const input = decodeArgs<{ registryId: string }>(call.payload);
			const reg = await findRegistryById(input.registryId);
			if (reg.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not allowed to delete this registry",
				);
			}
			console.info("[audit] registry.delete", {
				action: "delete",
				resourceType: "registry",
				resourceId: reg.registryId,
				resourceName: reg.registryName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return await removeRegistry(input.registryId);
		}

		case RegistryMethod.update: {
			const input = decodeArgs<{
				registryId: string;
				[k: string]: unknown;
				// biome-ignore lint/suspicious/noExplicitAny: apiUpdateRegistry input, ported verbatim
			}>(call.payload) as any;
			const { registryId, ...rest } = input;
			const reg = await findRegistryById(registryId);
			if (reg.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not allowed to update this registry",
				);
			}
			const application = await updateRegistry(registryId, {
				...rest,
			});

			if (!application) {
				throw new BadRequestError("Error updating registry");
			}

			console.info("[audit] registry.update", {
				action: "update",
				resourceType: "registry",
				resourceId: registryId,
				resourceName: reg.registryName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case RegistryMethod.all: {
			const registryResponse = await db.query.registry.findMany({
				where: eq(registry.organizationId, ctx.organizationId),
			});
			return registryResponse;
		}

		case RegistryMethod.one: {
			const input = decodeArgs<{ registryId: string }>(call.payload);
			const reg = await findRegistryById(input.registryId);
			if (reg.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not allowed to access this registry",
				);
			}
			return reg;
		}

		case RegistryMethod.testRegistry: {
			const input = decodeArgs<{
				registryUrl: string;
				username: string;
				password: string;
				serverId?: string;
			}>(call.payload);
			try {
				const args = [
					"login",
					input.registryUrl,
					"--username",
					input.username,
					"--password-stdin",
				];

				if (IS_CLOUD && !input.serverId) {
					throw new NotFoundError("Select a server to test the registry");
				}

				if (input.serverId && input.serverId !== "none") {
					await execAsyncRemote(
						input.serverId,
						`echo ${input.password} | docker ${args.join(" ")}`,
					);
				} else {
					await execFileAsync("docker", args, {
						input: Buffer.from(input.password).toString(),
					});
				}

				return true;
			} catch (error) {
				if (error instanceof NotFoundError) throw error;
				throw new BadRequestError(
					error instanceof Error ? error.message : "Error testing the registry",
				);
			}
		}

		case RegistryMethod.testRegistryById: {
			const input = decodeArgs<{ registryId?: string; serverId?: string }>(
				call.payload,
			);
			try {
				const registryData = await db.query.registry.findFirst({
					where: eq(registry.registryId, input.registryId ?? ""),
				});

				if (!registryData) {
					throw new NotFoundError("Registry not found");
				}

				if (registryData.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You are not allowed to test this registry",
					);
				}

				const args = [
					"login",
					registryData.registryUrl,
					"--username",
					registryData.username,
					"--password-stdin",
				];

				if (IS_CLOUD && !input.serverId) {
					throw new NotFoundError("Select a server to test the registry");
				}

				if (input.serverId && input.serverId !== "none") {
					await execAsyncRemote(
						input.serverId,
						`echo ${registryData.password} | docker ${args.join(" ")}`,
					);
				} else {
					await execFileAsync("docker", args, {
						input: Buffer.from(registryData.password).toString(),
					});
				}

				return true;
			} catch (error) {
				if (
					error instanceof NotFoundError ||
					error instanceof UnauthorizedError
				)
					throw error;
				throw new BadRequestError(
					error instanceof Error ? error.message : "Error testing the registry",
				);
			}
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
