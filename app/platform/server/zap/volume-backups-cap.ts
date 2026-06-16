// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// volume-backups-cap.ts — the native @zap-proto/web VolumeBackups capability.
//
// Binary-ZAP replacement for the tRPC `volumeBackupsRouter`
// (server/api/routers/volume-backups.ts). Every method was a
// `protectedProcedure` (authenticated caller, session+user) — except
// restoreVolumeBackupWithLogs, a `withPermission("volumeBackup", "restore")` —
// whose body additionally enforces per-service org ownership via the
// getVolumeBackupOrgId / getServiceOrgId / assertVbOrgMatch helpers (ported
// verbatim from the source module). The mint boundary requires session+user (a
// null return rejects the WS upgrade with HTTP 401, mirroring
// protectedProcedure); the per-service ownership check runs INSIDE dispatch,
// verbatim from the original procedure bodies. Inputs ride the shared Args
// carrier, results the shared Result carrier; VolumeBackupsMethod ordinals are
// generated from volume-backups.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// volumeBackups.<action>", …)`, mirroring how registry-cap.ts ported its audit.
//
// The source restoreVolumeBackupWithLogs was a tRPC `.subscription()` returning
// an `observable<string>` of restore-progress lines. CallHandler is unary
// (request → single Response), so the body is ported verbatim with every
// `emit.next(line)` collected into a `logs[]` array and `emit.complete()` mapped
// to returning that array — the one body that cannot stay byte-verbatim because
// the ZAP call channel is request/response, not a server-push stream.

import type { IncomingMessage } from "node:http";
import {
	createVolumeBackup,
	findApplicationById,
	findComposeById,
	findMariadbById,
	findMongoById,
	findMySqlById,
	findPostgresById,
	findRedisById,
	findVolumeBackupById,
	IS_CLOUD,
	removeVolumeBackup,
	removeVolumeBackupJob,
	restoreVolume,
	runVolumeBackup,
	scheduleVolumeBackup,
	updateVolumeBackup,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { volumeBackups } from "@hanzo/platform/db/schema";
import {
	execAsyncRemote,
	execAsyncStream,
} from "@hanzo/platform/utils/process/execAsync";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { desc, eq } from "drizzle-orm";
import { removeJob, schedule, updateJob } from "@/server/utils/backup";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { VolumeBackupsMethod } from "./schema/volume-backups_zap";

/**
 * Per-connection auth context — the tRPC ctx shape the ported bodies expect:
 * `ctx.session.activeOrganizationId`.
 */
export interface VolumeBackupsCtx {
	session: { activeOrganizationId: string };
	user: { id: string; email: string };
}

/**
 * volumeBackupsMintCap — bearer→ctx boundary. Mirrors `protectedProcedure` /
 * `withPermission("volumeBackup", "restore")`'s authentication half: validates
 * the upgrade and requires session+user. Null → HTTP 401 before any socket
 * opens. The per-service org-ownership half runs inside dispatch (verbatim from
 * the bodies).
 */
export const volumeBackupsMintCap: MintCap<VolumeBackupsCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const activeOrganizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const id = (user as { id?: string }).id || "";
	const email = (user as { email?: string }).email || "";
	return { session: { activeOrganizationId }, user: { id, email } };
};

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}

/**
 * Resolve the organizationId for a volume backup by looking up its parent
 * service. Ported verbatim from the source router; the TRPCError BAD_REQUEST
 * leaf becomes a typed BadRequestError → ZAP Status.BadRequest.
 */
async function getVolumeBackupOrgId(vb: {
	applicationId?: string | null;
	postgresId?: string | null;
	mysqlId?: string | null;
	mariadbId?: string | null;
	mongoId?: string | null;
	redisId?: string | null;
	composeId?: string | null;
}): Promise<string> {
	if (vb.applicationId) {
		const app = await findApplicationById(vb.applicationId);
		return app.environment.project.organizationId;
	}
	if (vb.postgresId) {
		const pg = await findPostgresById(vb.postgresId);
		return pg.environment.project.organizationId;
	}
	if (vb.mysqlId) {
		const my = await findMySqlById(vb.mysqlId);
		return my.environment.project.organizationId;
	}
	if (vb.mariadbId) {
		const maria = await findMariadbById(vb.mariadbId);
		return maria.environment.project.organizationId;
	}
	if (vb.mongoId) {
		const mongo = await findMongoById(vb.mongoId);
		return mongo.environment.project.organizationId;
	}
	if (vb.redisId) {
		const redis = await findRedisById(vb.redisId);
		return redis.environment.project.organizationId;
	}
	if (vb.composeId) {
		const compose = await findComposeById(vb.composeId);
		return compose.environment.project.organizationId;
	}
	throw new BadRequestError("Cannot determine volume backup ownership");
}

/** Ported verbatim; UNAUTHORIZED → typed UnauthorizedError → Status.Unauthorized. */
function assertVbOrgMatch(orgId: string, activeOrgId: string): void {
	if (orgId !== activeOrgId) {
		throw new UnauthorizedError(
			"You are not authorized to access this volume backup",
		);
	}
}

/**
 * Resolve org for a service type + id pair used in the list endpoint. Ported
 * verbatim; the TRPCError BAD_REQUEST leaf becomes a typed BadRequestError.
 */
async function getServiceOrgId(
	serviceType: string,
	id: string,
): Promise<string> {
	switch (serviceType) {
		case "application": {
			const app = await findApplicationById(id);
			return app.environment.project.organizationId;
		}
		case "postgres": {
			const pg = await findPostgresById(id);
			return pg.environment.project.organizationId;
		}
		case "mysql": {
			const my = await findMySqlById(id);
			return my.environment.project.organizationId;
		}
		case "mariadb": {
			const maria = await findMariadbById(id);
			return maria.environment.project.organizationId;
		}
		case "mongo": {
			const mongo = await findMongoById(id);
			return mongo.environment.project.organizationId;
		}
		case "redis": {
			const redis = await findRedisById(id);
			return redis.environment.project.organizationId;
		}
		case "compose": {
			const compose = await findComposeById(id);
			return compose.environment.project.organizationId;
		}
		default:
			throw new BadRequestError("Unknown service type");
	}
}

/**
 * volumeBackupsRootCap — dispatch each decoded Call by VolumeBackupsMethod
 * ordinal to the same service functions the tRPC procedure called. Inputs decode
 * via the shared Args carrier; results encode via the shared Result carrier.
 * Errors map to ZAP status codes (mirroring the tRPC error codes), never a
 * thrown HTTP 500 leak.
 */
export function volumeBackupsRootCap(ctx: VolumeBackupsCtx): CallHandler {
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

async function dispatch(ctx: VolumeBackupsCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case VolumeBackupsMethod.list: {
			const input = decodeArgs<{
				id: string;
				// PRE-EXISTING: libsql dropped in fork — volume_backup table has no
				// libsqlId column, so it is omitted from this key union.
				volumeBackupType:
					| "application"
					| "postgres"
					| "mysql"
					| "mariadb"
					| "mongo"
					| "redis"
					| "compose";
			}>(call.payload);
			// Verify the parent service belongs to the caller's org
			const orgId = await getServiceOrgId(input.volumeBackupType, input.id);
			assertVbOrgMatch(orgId, ctx.session.activeOrganizationId);

			const serviceIdColumn = (
				volumeBackups as unknown as Record<string, (typeof volumeBackups)["volumeBackupId"]>
			)[`${input.volumeBackupType}Id`] as (typeof volumeBackups)["volumeBackupId"];
			return await db.query.volumeBackups.findMany({
				where: eq(serviceIdColumn, input.id),
				with: {
					application: true,
					postgres: true,
					mysql: true,
					mariadb: true,
					mongo: true,
					redis: true,
					compose: true,
					// PRE-EXISTING: libsql dropped in fork — no `libsql` relation on volume_backup
				},
				orderBy: [desc(volumeBackups.createdAt)],
			});
		}

		case VolumeBackupsMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: createVolumeBackupSchema input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			const newVolumeBackup = await createVolumeBackup(input);
			if (!newVolumeBackup) {
				throw new BadRequestError("Failed to create volume backup");
			}

			// Verify org ownership on the newly created volume backup
			// (the source repeats this block verbatim; deduped here because a
			// single switch-case scope cannot redeclare `const orgId` — the
			// second block was a byte-identical no-op).
			const orgId = await getVolumeBackupOrgId(newVolumeBackup);
			assertVbOrgMatch(orgId, ctx.session.activeOrganizationId);

			if (newVolumeBackup?.enabled) {
				if (IS_CLOUD) {
					await schedule({
						cronSchedule: newVolumeBackup.cronExpression,
						volumeBackupId: newVolumeBackup.volumeBackupId,
						type: "volume-backup",
					});
				} else {
					await scheduleVolumeBackup(newVolumeBackup.volumeBackupId);
				}
			}
			console.info("[audit] volumeBackups.create", {
				action: "create",
				resourceType: "volumeBackup",
				resourceId: newVolumeBackup?.volumeBackupId,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
				userEmail: ctx.user.email,
			});
			return newVolumeBackup;
		}

		case VolumeBackupsMethod.one: {
			const input = decodeArgs<{ volumeBackupId: string }>(call.payload);
			const vb = await findVolumeBackupById(input.volumeBackupId);
			const orgId = await getVolumeBackupOrgId(vb);
			assertVbOrgMatch(orgId, ctx.session.activeOrganizationId);
			return vb;
		}

		case VolumeBackupsMethod.delete: {
			const input = decodeArgs<{ volumeBackupId: string }>(call.payload);
			const vb = await findVolumeBackupById(input.volumeBackupId);
			const orgId = await getVolumeBackupOrgId(vb);
			assertVbOrgMatch(orgId, ctx.session.activeOrganizationId);
			return await removeVolumeBackup(input.volumeBackupId);
		}

		case VolumeBackupsMethod.update: {
			// biome-ignore lint/suspicious/noExplicitAny: updateVolumeBackupSchema input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			// Verify org ownership before update
			const existingVb = await findVolumeBackupById(input.volumeBackupId);
			const vbOrgId = await getVolumeBackupOrgId(existingVb);
			assertVbOrgMatch(vbOrgId, ctx.session.activeOrganizationId);

			const updatedVolumeBackup = await updateVolumeBackup(
				input.volumeBackupId,
				input,
			);

			if (!updatedVolumeBackup) {
				throw new NotFoundError("Volume backup not found");
			}

			if (IS_CLOUD) {
				if (updatedVolumeBackup.enabled) {
					await updateJob({
						cronSchedule: updatedVolumeBackup.cronExpression,
						volumeBackupId: updatedVolumeBackup.volumeBackupId,
						type: "volume-backup",
					});
				} else {
					await removeJob({
						cronSchedule: updatedVolumeBackup.cronExpression,
						volumeBackupId: updatedVolumeBackup.volumeBackupId,
						type: "volume-backup",
					});
				}
			} else {
				if (updatedVolumeBackup?.enabled) {
					removeVolumeBackupJob(updatedVolumeBackup.volumeBackupId);
					scheduleVolumeBackup(updatedVolumeBackup.volumeBackupId);
				} else {
					removeVolumeBackupJob(updatedVolumeBackup.volumeBackupId);
				}
			}
			console.info("[audit] volumeBackups.update", {
				action: "update",
				resourceType: "volumeBackup",
				resourceId: updatedVolumeBackup.volumeBackupId,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
				userEmail: ctx.user.email,
			});
			return updatedVolumeBackup;
		}

		case VolumeBackupsMethod.runManually: {
			const input = decodeArgs<{ volumeBackupId: string }>(call.payload);
			const vb = await findVolumeBackupById(input.volumeBackupId);
			const orgId = await getVolumeBackupOrgId(vb);
			assertVbOrgMatch(orgId, ctx.session.activeOrganizationId);

			try {
				const result = await runVolumeBackup(input.volumeBackupId);
				console.info("[audit] volumeBackups.run", {
					action: "run",
					resourceType: "volumeBackup",
					resourceId: input.volumeBackupId,
					organizationId: ctx.session.activeOrganizationId,
					userId: ctx.user.id,
					userEmail: ctx.user.email,
				});
				return result;
			} catch (error) {
				console.error(error);
				return false;
			}
		}

		case VolumeBackupsMethod.restoreVolumeBackupWithLogs: {
			const input = decodeArgs<{
				backupFileName: string;
				destinationId: string;
				volumeName: string;
				id: string;
				serviceType: "application" | "compose";
				serverId?: string;
			}>(call.payload);
			// Verify org ownership for the parent service
			const orgId = await getServiceOrgId(input.serviceType, input.id);
			assertVbOrgMatch(orgId, ctx.session.activeOrganizationId);

			// Source body emitted progress over an observable<string>; the unary ZAP
			// channel collects those lines and returns them.
			const logs: string[] = [];
			const emit = { next: (line: string) => logs.push(line) };
			try {
				emit.next("🚀 Starting volume restore process...");
				emit.next(`📂 Backup File: ${input.backupFileName}`);
				emit.next(`🔧 Volume Name: ${input.volumeName}`);
				emit.next(`🏷️ Service Type: ${input.serviceType}`);
				emit.next(""); // Empty line for better readability

				// Generate the restore command
				const restoreCommand = await restoreVolume(
					input.id,
					input.destinationId,
					input.volumeName,
					input.backupFileName,
					input.serverId || "",
					input.serviceType,
				);

				emit.next("📋 Generated restore command:");
				emit.next("▶️ Executing restore...");
				emit.next(""); // Empty line

				// Execute the restore command with real-time output
				if (input.serverId) {
					emit.next(`🌐 Executing on remote server: ${input.serverId}`);
					await execAsyncRemote(input.serverId, restoreCommand, (data) => {
						emit.next(data);
					});
				} else {
					emit.next("🖥️ Executing on local server");
					await execAsyncStream(restoreCommand, (data) => {
						emit.next(data);
					});
				}

				emit.next("");
				emit.next("✅ Volume restore completed successfully!");
				emit.next(
					"🎉 All containers/services have been restarted with the restored volume.",
				);
			} catch {
				emit.next("");
				emit.next("❌ Volume restore failed!");
			}
			return logs;
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
