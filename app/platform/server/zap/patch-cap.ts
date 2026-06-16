// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// patch-cap.ts — the native @zap-proto/web Patch capability.
//
// Binary-ZAP replacement for the tRPC `patchRouter`
// (server/api/routers/patch.ts). Every method was a `protectedProcedure`
// (authenticated caller, session+user) whose body additionally enforces
// per-service permission via checkServicePermissionAndAccess — except
// `cleanPatchRepos`, which was an `adminProcedure` (owner|admin only), gated
// per-call inside dispatch via requireAdmin(ctx). The mint boundary requires
// session+user (a null return rejects the WS upgrade with HTTP 401, mirroring
// protectedProcedure); the per-service permission half is enforced INSIDE
// dispatch, verbatim from the original procedure bodies. Inputs ride the shared
// Args carrier, results the shared Result carrier; PatchMethod ordinals are
// generated from patch.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// patch.<action>", …)`, mirroring how port-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	checkServicePermissionAndAccess,
	cleanPatchRepos,
	createPatch,
	deletePatch,
	ensurePatchRepo,
	findApplicationById,
	findComposeById,
	findPatchByFilePath,
	findPatchById,
	findPatchesByEntityId,
	markPatchForDeletion,
	readPatchRepoDirectory,
	readPatchRepoFile,
	updatePatch,
} from "@hanzo/platform";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { PatchMethod } from "./schema/patch_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface PatchCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * patchMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication half: validates the upgrade and requires session+user. Null →
 * HTTP 401 before any socket opens. The per-service permission half (and the
 * admin gate for cleanPatchRepos) run inside dispatch.
 */
export const patchMintCap: MintCap<PatchCtx> = async (req: IncomingMessage) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as PatchCtx["userRole"];
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
/** Typed internal failure → ZAP Status.Internal. */
class InternalError extends Error {}

/** Admin gate — mirrors `adminProcedure` (owner|admin only). */
function requireAdmin(ctx: PatchCtx): void {
	if (ctx.userRole !== "owner" && ctx.userRole !== "admin") {
		throw new UnauthorizedError("admin role required");
	}
}

/**
 * Resolves the serviceId from a patch record (applicationId or composeId).
 * Throws if neither is set.
 */
const resolvePatchServiceId = (patch: {
	applicationId: string | null;
	composeId: string | null;
}): string => {
	const serviceId = patch.applicationId ?? patch.composeId;
	if (!serviceId) {
		throw new InternalError("Patch has no associated service");
	}
	return serviceId;
};

/**
 * patchRootCap — dispatch each decoded Call by PatchMethod ordinal to the same
 * service functions the tRPC procedure called. Inputs decode via the shared Args
 * carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function patchRootCap(ctx: PatchCtx): CallHandler {
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

async function dispatch(ctx: PatchCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case PatchMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: apiCreatePatch input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			const serviceId = input.applicationId ?? input.composeId;
			if (!serviceId) {
				throw new BadRequestError(
					"Either applicationId or composeId must be provided",
				);
			}
			await checkServicePermissionAndAccess(ctx, serviceId, {
				service: ["create"],
			});
			const result = await createPatch(input);
			console.info("[audit] patch.create", {
				action: "create",
				resourceType: "settings",
				resourceId: result.patchId,
				resourceName: result.filePath,
				metadata: { type: "patch" },
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return result;
		}

		case PatchMethod.one: {
			const input = decodeArgs<{ patchId: string }>(call.payload);
			const patch = await findPatchById(input.patchId);
			const serviceId = resolvePatchServiceId(patch);
			await checkServicePermissionAndAccess(ctx, serviceId, {
				service: ["read"],
			});
			return patch;
		}

		case PatchMethod.byEntityId: {
			const input = decodeArgs<{
				id: string;
				type: "application" | "compose";
			}>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.id, {
				service: ["read"],
			});
			return await findPatchesByEntityId(input.id, input.type);
		}

		case PatchMethod.update: {
			// biome-ignore lint/suspicious/noExplicitAny: apiUpdatePatch input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			const patch = await findPatchById(input.patchId);
			const serviceId = resolvePatchServiceId(patch);
			await checkServicePermissionAndAccess(ctx, serviceId, {
				service: ["create"],
			});
			const { patchId, ...data } = input;
			const result = await updatePatch(patchId, data);
			console.info("[audit] patch.update", {
				action: "update",
				resourceType: "settings",
				resourceId: patchId,
				resourceName: patch.filePath,
				metadata: { type: "patch" },
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return result;
		}

		case PatchMethod.delete: {
			const input = decodeArgs<{ patchId: string }>(call.payload);
			const patch = await findPatchById(input.patchId);
			const serviceId = resolvePatchServiceId(patch);
			await checkServicePermissionAndAccess(ctx, serviceId, {
				service: ["delete"],
			});
			const result = await deletePatch(input.patchId);
			console.info("[audit] patch.delete", {
				action: "delete",
				resourceType: "settings",
				resourceId: input.patchId,
				resourceName: patch.filePath,
				metadata: { type: "patch" },
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return result;
		}

		case PatchMethod.toggleEnabled: {
			const input = decodeArgs<{ patchId: string; enabled: boolean }>(
				call.payload,
			);
			const patch = await findPatchById(input.patchId);
			const serviceId = resolvePatchServiceId(patch);
			await checkServicePermissionAndAccess(ctx, serviceId, {
				service: ["create"],
			});
			const result = await updatePatch(input.patchId, {
				enabled: input.enabled,
			});
			console.info("[audit] patch.update", {
				action: "update",
				resourceType: "settings",
				resourceId: input.patchId,
				resourceName: patch.filePath,
				metadata: { type: "patch", enabled: input.enabled },
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return result;
		}

		case PatchMethod.ensureRepo: {
			const input = decodeArgs<{
				id: string;
				type: "application" | "compose";
			}>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.id, {
				service: ["create"],
			});
			const result = await ensurePatchRepo({
				type: input.type,
				id: input.id,
			});
			console.info("[audit] patch.create", {
				action: "create",
				resourceType: "settings",
				resourceId: input.id,
				metadata: { type: "ensurePatchRepo", serviceType: input.type },
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return result;
		}

		case PatchMethod.readRepoDirectories: {
			const input = decodeArgs<{
				id: string;
				type: "application" | "compose";
				repoPath: string;
			}>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.id, {
				service: ["read"],
			});
			let serverId: string | null = null;
			if (input.type === "application") {
				const app = await findApplicationById(input.id);
				serverId = app.serverId;
			} else {
				const compose = await findComposeById(input.id);
				serverId = compose.serverId;
			}
			return await readPatchRepoDirectory(input.repoPath, serverId);
		}

		case PatchMethod.readRepoFile: {
			const input = decodeArgs<{
				id: string;
				type: "application" | "compose";
				filePath: string;
			}>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.id, {
				service: ["read"],
			});
			let serverId: string | null = null;
			if (input.type === "application") {
				const app = await findApplicationById(input.id);
				serverId = app.serverId;
			} else {
				const compose = await findComposeById(input.id);
				serverId = compose.serverId;
			}
			const existingPatch = await findPatchByFilePath(
				input.filePath,
				input.id,
				input.type,
			);
			// For delete patches, show current file content from repo (what will be deleted)
			if (existingPatch?.type === "delete") {
				try {
					return await readPatchRepoFile(input.id, input.type, input.filePath);
				} catch {
					return "(File not found in repo - will be removed if it exists)";
				}
			}
			if (existingPatch?.content) {
				return existingPatch.content;
			}
			return await readPatchRepoFile(input.id, input.type, input.filePath);
		}

		case PatchMethod.saveFileAsPatch: {
			const input = decodeArgs<{
				id: string;
				type: "application" | "compose";
				filePath: string;
				content: string;
				patchType: "create" | "update";
			}>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.id, {
				service: ["create"],
			});
			const existingPatch = await findPatchByFilePath(
				input.filePath,
				input.id,
				input.type,
			);
			if (!existingPatch) {
				const result = await createPatch({
					filePath: input.filePath,
					content: input.content,
					type: input.patchType,
					applicationId: input.type === "application" ? input.id : undefined,
					composeId: input.type === "compose" ? input.id : undefined,
				});
				console.info("[audit] patch.create", {
					action: "create",
					resourceType: "settings",
					resourceId: result.patchId,
					resourceName: input.filePath,
					metadata: { type: "saveFileAsPatch" },
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return result;
			}
			const result = await updatePatch(existingPatch.patchId, {
				content: input.content,
				type: input.patchType,
			});
			console.info("[audit] patch.update", {
				action: "update",
				resourceType: "settings",
				resourceId: existingPatch.patchId,
				resourceName: input.filePath,
				metadata: { type: "saveFileAsPatch" },
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return result;
		}

		case PatchMethod.markFileForDeletion: {
			const input = decodeArgs<{
				id: string;
				type: "application" | "compose";
				filePath: string;
			}>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.id, {
				service: ["create"],
			});
			const result = await markPatchForDeletion(
				input.filePath,
				input.id,
				input.type,
			);
			console.info("[audit] patch.delete", {
				action: "delete",
				resourceType: "settings",
				resourceId: input.id,
				resourceName: input.filePath,
				metadata: { type: "markFileForDeletion" },
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return result;
		}

		case PatchMethod.cleanPatchRepos: {
			requireAdmin(ctx);
			const input = decodeArgs<{ serverId?: string }>(call.payload);
			await cleanPatchRepos(input.serverId);
			console.info("[audit] patch.delete", {
				action: "delete",
				resourceType: "settings",
				resourceId: input.serverId || "local",
				metadata: { type: "cleanPatchRepos" },
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
