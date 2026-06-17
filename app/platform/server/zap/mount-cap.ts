// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// mount-cap.ts — the native @zap-proto/web Mount capability.
//
// Binary-ZAP replacement for the tRPC `mountRouter`
// (server/api/routers/mount.ts). Every method was a `protectedProcedure` — an
// authenticated caller (session+user) whose body additionally enforces
// per-mount/per-service org ownership. The mint boundary requires session+user
// (a null return rejects the WS upgrade with HTTP 401, mirroring
// protectedProcedure); the per-mount ownership checks are enforced INSIDE
// dispatch, verbatim from the original procedure bodies. Inputs ride the shared
// Args carrier, results the shared Result carrier; MountMethod ordinals are
// generated from mount.zap.

import type { IncomingMessage } from "node:http";
import {
	checkServiceAccess,
	createMount,
	deleteMount,
	findApplicationById,
	findComposeById,
	findMariadbById,
	findMongoById,
	findMountById,
	findMountOrganizationId,
	findMountsByApplicationId,
	findMySqlById,
	findPostgresById,
	findRedisById,
	getServiceContainer,
	updateMount,
} from "@hanzo/platform";
import type { ServiceType } from "@hanzo/platform/db/schema/mount";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { MountMethod } from "./schema/mount_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface MountCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * mountMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication: validates the upgrade and requires session+user. Null → HTTP
 * 401 before any socket opens. The per-mount org-ownership checks run inside
 * dispatch (verbatim from the bodies).
 */
export const mountMintCap: MintCap<MountCtx> = async (req: IncomingMessage) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as MountCtx["userRole"];
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

async function getServiceOrganizationId(
	serviceId: string,
	serviceType: ServiceType,
): Promise<string | null> {
	switch (serviceType) {
		case "application": {
			const app = await findApplicationById(serviceId);
			return app?.environment?.project?.organizationId ?? null;
		}
		case "postgres": {
			const postgres = await findPostgresById(serviceId);
			return postgres?.environment?.project?.organizationId ?? null;
		}
		case "mariadb": {
			const mariadb = await findMariadbById(serviceId);
			return mariadb?.environment?.project?.organizationId ?? null;
		}
		case "mongo": {
			const mongo = await findMongoById(serviceId);
			return mongo?.environment?.project?.organizationId ?? null;
		}
		case "mysql": {
			const mysql = await findMySqlById(serviceId);
			return mysql?.environment?.project?.organizationId ?? null;
		}
		case "redis": {
			const redis = await findRedisById(serviceId);
			return redis?.environment?.project?.organizationId ?? null;
		}
		case "compose": {
			const compose = await findComposeById(serviceId);
			return compose?.environment?.project?.organizationId ?? null;
		}
		default:
			return null;
	}
}

/**
 * mountRootCap — dispatch each decoded Call by MountMethod ordinal to the same
 * service functions the tRPC procedure called. Inputs decode via the shared Args
 * carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function mountRootCap(ctx: MountCtx): CallHandler {
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

async function dispatch(ctx: MountCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case MountMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: apiCreateMount input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			// Verify the target service belongs to the caller's org
			// by resolving serviceId through findMountOrganizationId-compatible lookup.
			// The mount hasn't been created yet, so we check the target serviceId directly.
			if (input.serviceType === "application") {
				const app = await findApplicationById(input.serviceId);
				if (
					app.environment.project.organizationId !== ctx.organizationId
				) {
					throw new UnauthorizedError(
						"You are not authorized to create mounts on this service",
					);
				}
			}
			await createMount(input);
			return true;
		}

		case MountMethod.remove: {
			const input = decodeArgs<{ mountId: string }>(call.payload);
			const organizationId = await findMountOrganizationId(input.mountId);
			if (organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not authorized to delete this mount",
				);
			}
			return await deleteMount(input.mountId);
		}

		case MountMethod.one: {
			const input = decodeArgs<{ mountId: string }>(call.payload);
			const organizationId = await findMountOrganizationId(input.mountId);
			if (organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not authorized to access this mount",
				);
			}
			return await findMountById(input.mountId);
		}

		case MountMethod.update: {
			// biome-ignore lint/suspicious/noExplicitAny: apiUpdateMount input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			const organizationId = await findMountOrganizationId(input.mountId);
			if (organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not authorized to update this mount",
				);
			}
			return await updateMount(input.mountId, input);
		}

		case MountMethod.allNamedByApplicationId: {
			const input = decodeArgs<{ applicationId: string }>(call.payload);
			const app = await findApplicationById(input.applicationId);
			if (app.environment.project.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not authorized to access this application",
				);
			}
			const container = await getServiceContainer(app.appName, app.serverId);
			const mounts = container?.Mounts.filter(
				// biome-ignore lint/suspicious/noExplicitAny: docker mount shape, ported verbatim
				(mount: any) => mount.Type === "volume" && mount.Source !== "",
			);
			return mounts;
		}

		case MountMethod.listByServiceId: {
			const input = decodeArgs<{
				serviceId: string;
				serviceType: ServiceType;
			}>(call.payload);
			console.log("input", input);
			if (ctx.userRole === "member") {
				await checkServiceAccess(
					ctx.userId,
					input.serviceId,
					ctx.organizationId,
					"access",
				);
			}
			const organizationId = await getServiceOrganizationId(
				input.serviceId,
				input.serviceType,
			);
			if (
				organizationId === null ||
				organizationId !== ctx.organizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to access this service or it does not exist",
				);
			}
			return await findMountsByApplicationId(
				input.serviceId,
				input.serviceType,
			);
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
