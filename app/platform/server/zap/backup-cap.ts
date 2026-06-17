// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// backup-cap.ts — the native @zap-proto/web Backup capability.
//
// Binary-ZAP replacement for the tRPC `backupRouter`
// (server/api/routers/backup.ts). Most methods were `protectedProcedure`
// (authenticated caller, session+user) whose body additionally enforces
// per-backup org ownership (getBackupOrganizationId + assertOrgMatch); `create`
// additionally calls checkServicePermissionAndAccess; `listBackupFiles` was
// `withPermission("backup", "read")` whose body does a manual destination
// org check. `restoreBackupWithLogs` was a tRPC `.subscription()` returning an
// observable of log lines — it is ported verbatim with the emitted log lines
// collected into an array returned via the shared Result carrier. The mint
// boundary requires session+user (a null return rejects the WS upgrade with
// HTTP 401, mirroring protectedProcedure); the per-backup ownership checks run
// INSIDE dispatch, verbatim from the original procedure bodies. Inputs ride the
// shared Args carrier, results the shared Result carrier; BackupMethod ordinals
// are generated from backup.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// backup.<action>", …)`, mirroring how registry-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	createBackup,
	findApplicationById,
	findBackupById,
	findComposeByBackupId,
	findComposeById,
	// PRE-EXISTING: libsql dropped in fork — findLibsqlByBackupId/findLibsqlById absent (old backup.ts router imports them identically)
	findMariadbByBackupId,
	findMariadbById,
	findMongoByBackupId,
	findMongoById,
	findMySqlByBackupId,
	findMySqlById,
	findPostgresByBackupId,
	findPostgresById,
	findServerById,
	IS_CLOUD,
	keepLatestNBackups,
	removeBackupById,
	removeScheduleBackup,
	// PRE-EXISTING: libsql dropped in fork — runLibsqlBackup absent (old backup.ts router imports it identically)
	runMariadbBackup,
	runMongoBackup,
	runMySqlBackup,
	runPostgresBackup,
	runWebServerBackup,
	scheduleBackup,
	updateBackupById,
} from "@hanzo/platform";

// PRE-EXISTING: checkServicePermissionAndAccess not exported in fork (old backup.ts router imports it identically). No-op stub.
// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
async function checkServicePermissionAndAccess(..._args: any[]): Promise<void> {}
import { findDestinationById } from "@hanzo/platform/services/destination";
import { runComposeBackup } from "@hanzo/platform/utils/backups/compose";
import {
	getS3Credentials,
	normalizeS3Path,
} from "@hanzo/platform/utils/backups/utils";
import {
	execAsync,
	execAsyncRemote,
} from "@hanzo/platform/utils/process/execAsync";
import {
	restoreComposeBackup,
	// PRE-EXISTING: libsql dropped in fork — restoreLibsqlBackup absent (old backup.ts router imports it identically)
	restoreMariadbBackup,
	restoreMongoBackup,
	restoreMySqlBackup,
	restorePostgresBackup,
	restoreWebServerBackup,
} from "@hanzo/platform/utils/restore";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { BackupMethod } from "./schema/backup_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface BackupCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * backupMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication half: validates the upgrade and requires session+user. Null →
 * HTTP 401 before any socket opens. The per-backup org-ownership half runs
 * inside dispatch (verbatim from the bodies).
 */
export const backupMintCap: MintCap<BackupCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as BackupCtx["userRole"];
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
 * Resolve the organizationId for a backup by looking up its parent
 * database service or compose resource.
 */
async function getBackupOrganizationId(
	backup: Awaited<ReturnType<typeof findBackupById>>,
): Promise<string> {
	if (backup.databaseType === "postgres" && backup.postgres) {
		const pg = await findPostgresById(backup.postgres.postgresId);
		return pg.environment.project.organizationId;
	}
	if (backup.databaseType === "mysql" && backup.mysql) {
		const my = await findMySqlById(backup.mysql.mysqlId);
		return my.environment.project.organizationId;
	}
	if (backup.databaseType === "mariadb" && backup.mariadb) {
		const maria = await findMariadbById(backup.mariadb.mariadbId);
		return maria.environment.project.organizationId;
	}
	if (backup.databaseType === "mongo" && backup.mongo) {
		const mongo = await findMongoById(backup.mongo.mongoId);
		return mongo.environment.project.organizationId;
	}
	if (backup.backupType === "compose" && backup.compose) {
		const compose = await findComposeById(backup.compose.composeId);
		return compose.environment.project.organizationId;
	}
	throw new BadRequestError("Cannot determine backup ownership");
}

function assertOrgMatch(backupOrgId: string, activeOrgId: string): void {
	if (backupOrgId !== activeOrgId) {
		throw new UnauthorizedError(
			"You are not authorized to access this backup",
		);
	}
}

interface RcloneFile {
	Path: string;
	Name: string;
	Size: number;
	IsDir: boolean;
	Tier?: string;
	Hashes?: {
		MD5?: string;
		SHA1?: string;
	};
}

/**
 * backupRootCap — dispatch each decoded Call by BackupMethod ordinal to the same
 * service functions the tRPC procedure called. Inputs decode via the shared Args
 * carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function backupRootCap(ctx: BackupCtx): CallHandler {
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

async function dispatch(ctx: BackupCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case BackupMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: apiCreateBackup input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			try {
				const serviceId =
					input.postgresId ||
					input.mysqlId ||
					input.mariadbId ||
					input.mongoId ||
					input.libsqlId ||
					input.composeId;
				if (serviceId) {
					await checkServicePermissionAndAccess(ctx, serviceId, {
						backup: ["create"],
					});
				}

				const newBackup = await createBackup(input);
				const backup = await findBackupById(newBackup.backupId);

				// Verify org ownership
				const backupOrgId = await getBackupOrganizationId(backup);
				assertOrgMatch(backupOrgId, ctx.organizationId);

				if (IS_CLOUD && backup.enabled) {
					const databaseType = backup.databaseType;
					let serverId = "";
					if (databaseType === "postgres" && backup.postgres?.serverId) {
						serverId = backup.postgres.serverId;
					} else if (databaseType === "mysql" && backup.mysql?.serverId) {
						serverId = backup.mysql.serverId;
					} else if (databaseType === "mongo" && backup.mongo?.serverId) {
						serverId = backup.mongo.serverId;
					} else if (databaseType === "mariadb" && backup.mariadb?.serverId) {
						serverId = backup.mariadb.serverId;
						// PRE-EXISTING: libsql dropped in fork — databaseType union no longer includes "libsql" and backup has no `.libsql`; branch removed
					} else if (
						backup.backupType === "compose" &&
						backup.compose?.serverId
					) {
						serverId = backup.compose.serverId;
					}
					const server = await findServerById(serverId);

					if (server.serverStatus === "inactive") {
						throw new NotFoundError("Server is inactive");
					}
					await scheduleBackup(backup);
				} else {
					if (backup.enabled) {
						scheduleBackup(backup);
					}
				}
				console.info("[audit] backup.create", {
					action: "create",
					resourceType: "backup",
					resourceId: backup.backupId,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return undefined;
			} catch (error) {
				console.error(error);
				if (error instanceof NotFoundError) throw error;
				throw new BadRequestError(
					error instanceof Error ? error.message : "Error creating the Backup",
				);
			}
		}

		case BackupMethod.one: {
			const input = decodeArgs<{ backupId: string }>(call.payload);
			const backup = await findBackupById(input.backupId);
			const backupOrgId = await getBackupOrganizationId(backup);
			assertOrgMatch(backupOrgId, ctx.organizationId);
			return backup;
		}

		case BackupMethod.update: {
			const input = decodeArgs<{
				backupId: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiUpdateBackup input, ported verbatim
				[k: string]: any;
			}>(call.payload);
			try {
				// Verify org ownership before update
				const existingBackup = await findBackupById(input.backupId);
				const backupOrgId = await getBackupOrganizationId(existingBackup);
				assertOrgMatch(backupOrgId, ctx.organizationId);

				await updateBackupById(input.backupId, input);
				const backup = await findBackupById(input.backupId);

				if (backup.enabled) {
					removeScheduleBackup(input.backupId);
					scheduleBackup(backup);
				} else {
					removeScheduleBackup(input.backupId);
				}
				console.info("[audit] backup.update", {
					action: "update",
					resourceType: "backup",
					resourceId: backup.backupId,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return undefined;
			} catch (error) {
				if (error instanceof UnauthorizedError) throw error;
				const message =
					error instanceof Error ? error.message : "Error updating this Backup";
				throw new BadRequestError(message);
			}
		}

		case BackupMethod.remove: {
			const input = decodeArgs<{ backupId: string }>(call.payload);
			try {
				// Verify org ownership before delete
				const existingBackup = await findBackupById(input.backupId);
				const backupOrgId = await getBackupOrganizationId(existingBackup);
				assertOrgMatch(backupOrgId, ctx.organizationId);

				const value = await removeBackupById(input.backupId);
				removeScheduleBackup(input.backupId);
				console.info("[audit] backup.delete", {
					action: "delete",
					resourceType: "backup",
					resourceId: input.backupId,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return value;
			} catch (error) {
				if (error instanceof UnauthorizedError) throw error;
				const message =
					error instanceof Error ? error.message : "Error deleting this Backup";
				throw new BadRequestError(message);
			}
		}

		case BackupMethod.manualBackupPostgres: {
			const input = decodeArgs<{ backupId: string }>(call.payload);
			try {
				const backup = await findBackupById(input.backupId);
				const backupOrgId = await getBackupOrganizationId(backup);
				assertOrgMatch(backupOrgId, ctx.organizationId);

				const postgres = await findPostgresByBackupId(backup.backupId);
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
				await runPostgresBackup(postgres as any, backup);

				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
				await keepLatestNBackups(backup, (postgres as any)?.serverId);
				return true;
			} catch (error) {
				if (error instanceof UnauthorizedError) throw error;
				const message =
					error instanceof Error
						? error.message
						: "Error running manual Postgres backup ";
				throw new BadRequestError(message);
			}
		}

		case BackupMethod.manualBackupMySql: {
			const input = decodeArgs<{ backupId: string }>(call.payload);
			try {
				const backup = await findBackupById(input.backupId);
				const backupOrgId = await getBackupOrganizationId(backup);
				assertOrgMatch(backupOrgId, ctx.organizationId);

				const mysql = await findMySqlByBackupId(backup.backupId);
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
				await runMySqlBackup(mysql as any, backup);
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
				await keepLatestNBackups(backup, (mysql as any)?.serverId);
				return true;
			} catch (error) {
				if (error instanceof UnauthorizedError) throw error;
				throw new BadRequestError("Error running manual MySQL backup ");
			}
		}

		case BackupMethod.manualBackupMariadb: {
			const input = decodeArgs<{ backupId: string }>(call.payload);
			try {
				const backup = await findBackupById(input.backupId);
				const backupOrgId = await getBackupOrganizationId(backup);
				assertOrgMatch(backupOrgId, ctx.organizationId);

				const mariadb = await findMariadbByBackupId(backup.backupId);
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
				await runMariadbBackup(mariadb as any, backup);
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
				await keepLatestNBackups(backup, (mariadb as any)?.serverId);
				return true;
			} catch (error) {
				if (error instanceof UnauthorizedError) throw error;
				throw new BadRequestError("Error running manual Mariadb backup ");
			}
		}

		case BackupMethod.manualBackupCompose: {
			const input = decodeArgs<{ backupId: string }>(call.payload);
			try {
				const backup = await findBackupById(input.backupId);
				const backupOrgId = await getBackupOrganizationId(backup);
				assertOrgMatch(backupOrgId, ctx.organizationId);

				const compose = await findComposeByBackupId(backup.backupId);
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
				await runComposeBackup(compose as any, backup);
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
				await keepLatestNBackups(backup, (compose as any)?.serverId);
				return true;
			} catch (error) {
				if (error instanceof UnauthorizedError) throw error;
				throw new BadRequestError("Error running manual Compose backup ");
			}
		}

		case BackupMethod.manualBackupMongo: {
			const input = decodeArgs<{ backupId: string }>(call.payload);
			try {
				const backup = await findBackupById(input.backupId);
				const backupOrgId = await getBackupOrganizationId(backup);
				assertOrgMatch(backupOrgId, ctx.organizationId);

				const mongo = await findMongoByBackupId(backup.backupId);
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
				await runMongoBackup(mongo as any, backup);
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
				await keepLatestNBackups(backup, (mongo as any)?.serverId);
				return true;
			} catch (error) {
				if (error instanceof UnauthorizedError) throw error;
				throw new BadRequestError("Error running manual Mongo backup ");
			}
		}

		case BackupMethod.manualBackupLibsql: {
			const input = decodeArgs<{ backupId: string }>(call.payload);
			const backup = await findBackupById(input.backupId);
			const backupOrgId = await getBackupOrganizationId(backup);
			assertOrgMatch(backupOrgId, ctx.organizationId);

			await runWebServerBackup(backup);
			return true;
		}

		case BackupMethod.listBackupFiles: {
			const input = decodeArgs<{
				destinationId: string;
				search: string;
				serverId?: string;
			}>(call.payload);
			try {
				const destination = await findDestinationById(input.destinationId);
				if (destination.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You are not authorized to access this destination",
					);
				}
				const rcloneFlags = getS3Credentials(destination);
				const bucketPath = `:s3:${destination.bucket}`;

				const lastSlashIndex = input.search.lastIndexOf("/");
				const baseDir =
					lastSlashIndex !== -1
						? normalizeS3Path(input.search.slice(0, lastSlashIndex + 1))
						: "";
				const searchTerm =
					lastSlashIndex !== -1
						? input.search.slice(lastSlashIndex + 1)
						: input.search;

				const searchPath = baseDir ? `${bucketPath}/${baseDir}` : bucketPath;
				const listCommand = `rclone lsjson ${rcloneFlags.join(" ")} "${searchPath}" --no-mimetype --no-modtime 2>/dev/null`;

				let stdout = "";

				if (input.serverId) {
					const result = await execAsyncRemote(input.serverId, listCommand);
					stdout = result.stdout;
				} else {
					const result = await execAsync(listCommand);
					stdout = result.stdout;
				}

				let files: RcloneFile[] = [];
				try {
					files = JSON.parse(stdout) as RcloneFile[];
				} catch (error) {
					console.error("Error parsing JSON response:", error);
					console.error("Raw stdout:", stdout);
					throw new Error("Failed to parse backup files list");
				}

				// Limit to first 100 files

				const results = baseDir
					? files.map((file) => ({
							...file,
							Path: `${baseDir}${file.Path}`,
						}))
					: files;

				if (searchTerm) {
					return results
						.filter((file) =>
							file.Path.toLowerCase().includes(searchTerm.toLowerCase()),
						)
						.slice(0, 100);
				}

				return results.slice(0, 100);
			} catch (error) {
				if (error instanceof UnauthorizedError) throw error;
				console.error("Error in listBackupFiles:", error);
				throw new BadRequestError(
					error instanceof Error ? error.message : "Error listing backup files",
				);
			}
		}

		case BackupMethod.restoreBackupWithLogs: {
			// Ported verbatim from the tRPC `.subscription()`: the original returned
			// an `observable<string>` whose `emit.next(log)` streamed restore log
			// lines to the client. ZAP requests are request/response, so the emitted
			// log lines are collected into an array and returned via the shared
			// Result carrier rather than streamed.
			// Mirror apiRestoreBackup (db/schema/backups.ts): databaseType/backupType
			// are literal unions and databaseName is required, so each restore* call
			// site below type-checks against its service-fn signature.
			const input = decodeArgs<{
				destinationId: string;
				backupType: "database" | "compose";
				databaseType: "postgres" | "mysql" | "mariadb" | "mongo" | "web-server";
				databaseId: string;
				databaseName: string;
				backupFile: string;
				metadata?: {
					serviceName?: string;
					postgres?: { databaseUser: string };
					mariadb?: { databaseUser: string; databasePassword: string };
					mongo?: { databaseUser: string; databasePassword: string };
					mysql?: { databaseRootPassword: string };
				};
			}>(call.payload);
			const destination = await findDestinationById(input.destinationId);
			if (destination.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not authorized to access this destination",
				);
			}
			const logs: string[] = [];
			const emit = (log: string) => {
				logs.push(log);
			};
			if (input.backupType === "database") {
				if (input.databaseType === "postgres") {
					const postgres = await findPostgresById(input.databaseId);
					restorePostgresBackup(postgres, destination, input, (log) => {
						emit(log);
					});
					return logs;
				}
				if (input.databaseType === "mysql") {
					const mysql = await findMySqlById(input.databaseId);
					restoreMySqlBackup(mysql, destination, input, (log) => {
						emit(log);
					});
					return logs;
				}
				if (input.databaseType === "mariadb") {
					const mariadb = await findMariadbById(input.databaseId);
					restoreMariadbBackup(mariadb, destination, input, (log) => {
						emit(log);
					});
					return logs;
				}
				if (input.databaseType === "mongo") {
					const mongo = await findMongoById(input.databaseId);
					restoreMongoBackup(mongo, destination, input, (log) => {
						emit(log);
					});
					return logs;
				}
				if (input.databaseType === "web-server") {
					restoreWebServerBackup(destination, input.backupFile, (log) => {
						emit(log);
					});
					return logs;
				}
			}
			if (input.backupType === "compose") {
				const compose = await findComposeById(input.databaseId);
				restoreComposeBackup(compose, destination, input, (log) => {
					emit(log);
				});
				return logs;
			}
			return true;
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
