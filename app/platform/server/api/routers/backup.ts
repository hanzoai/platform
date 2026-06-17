import {
	createBackup,
	findApplicationById,
	findBackupById,
	findComposeByBackupId,
	findComposeById,
	findLibsqlByBackupId,
	findLibsqlById,
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
	runLibsqlBackup,
	runMariadbBackup,
	runMongoBackup,
	runMySqlBackup,
	runPostgresBackup,
	runWebServerBackup,
	scheduleBackup,
	updateBackupById,
} from "@hanzo/platform";
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
	restoreLibsqlBackup,
	restoreMariadbBackup,
	restoreMongoBackup,
	restoreMySqlBackup,
	restorePostgresBackup,
	restoreWebServerBackup,
} from "@hanzo/platform/utils/restore";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	createTRPCRouter,
	protectedProcedure,
	withPermission,
} from "@/server/api/trpc";
import { audit } from "@/server/api/utils/audit";
import { checkServicePermissionAndAccess } from "@hanzo/platform/services/permission";
import {
	apiCreateBackup,
	apiFindOneBackup,
	apiRemoveBackup,
	apiRestoreBackup,
	apiUpdateBackup,
} from "@/server/db/schema";
import { removeJob, schedule, updateJob } from "@/server/utils/backup";

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
	throw new TRPCError({
		code: "BAD_REQUEST",
		message: "Cannot determine backup ownership",
	});
}

function assertOrgMatch(
	backupOrgId: string,
	activeOrgId: string,
): void {
	if (backupOrgId !== activeOrgId) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "You are not authorized to access this backup",
		});
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

export const backupRouter = createTRPCRouter({
	create: protectedProcedure
		.input(apiCreateBackup)
		.mutation(async ({ input, ctx }) => {
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
				assertOrgMatch(backupOrgId, ctx.session.activeOrganizationId);

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
					} else if (databaseType === "libsql" && backup.libsql?.serverId) {
						serverId = backup.libsql.serverId;
					} else if (
						backup.backupType === "compose" &&
						backup.compose?.serverId
					) {
						serverId = backup.compose.serverId;
					}
					const server = await findServerById(serverId);

					if (server.serverStatus === "inactive") {
						throw new TRPCError({
							code: "NOT_FOUND",
							message: "Server is inactive",
						});
					}
					await schedule({
						cronSchedule: backup.schedule,
						backupId: backup.backupId,
						type: "backup",
					});
				} else {
					if (backup.enabled) {
						scheduleBackup(backup);
					}
				}
				await audit(ctx, {
					action: "create",
					resourceType: "backup",
					resourceId: backup.backupId,
				});
			} catch (error) {
				console.error(error);
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Error creating the Backup",
					cause: error,
				});
			}
		}),
	one: protectedProcedure
		.input(apiFindOneBackup)
		.query(async ({ input, ctx }) => {
			const backup = await findBackupById(input.backupId);
			const backupOrgId = await getBackupOrganizationId(backup);
			assertOrgMatch(backupOrgId, ctx.session.activeOrganizationId);
			return backup;
		}),
	update: protectedProcedure
		.input(apiUpdateBackup)
		.mutation(async ({ input, ctx }) => {
			try {
				// Verify org ownership before update
				const existingBackup = await findBackupById(input.backupId);
				const backupOrgId = await getBackupOrganizationId(existingBackup);
				assertOrgMatch(backupOrgId, ctx.session.activeOrganizationId);

				await updateBackupById(input.backupId, input);
				const backup = await findBackupById(input.backupId);

				if (IS_CLOUD) {
					if (backup.enabled) {
						await updateJob({
							cronSchedule: backup.schedule,
							backupId: backup.backupId,
							type: "backup",
						});
					} else {
						await removeJob({
							cronSchedule: backup.schedule,
							backupId: backup.backupId,
							type: "backup",
						});
					}
				} else {
					if (backup.enabled) {
						removeScheduleBackup(input.backupId);
						scheduleBackup(backup);
					} else {
						removeScheduleBackup(input.backupId);
					}
				}
				await audit(ctx, {
					action: "update",
					resourceType: "backup",
					resourceId: backup.backupId,
				});
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Error updating this Backup";
				throw new TRPCError({
					code: "BAD_REQUEST",
					message,
				});
			}
		}),
	remove: protectedProcedure
		.input(apiRemoveBackup)
		.mutation(async ({ input, ctx }) => {
			try {
				// Verify org ownership before delete
				const existingBackup = await findBackupById(input.backupId);
				const backupOrgId = await getBackupOrganizationId(existingBackup);
				assertOrgMatch(backupOrgId, ctx.session.activeOrganizationId);

				const value = await removeBackupById(input.backupId);
				if (IS_CLOUD && value) {
					removeJob({
						backupId: input.backupId,
						cronSchedule: value.schedule,
						type: "backup",
					});
				} else if (!IS_CLOUD) {
					removeScheduleBackup(input.backupId);
				}
				await audit(ctx, {
					action: "delete",
					resourceType: "backup",
					resourceId: input.backupId,
				});
				return value;
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Error deleting this Backup";
				throw new TRPCError({
					code: "BAD_REQUEST",
					message,
				});
			}
		}),
	manualBackupPostgres: protectedProcedure
		.input(apiFindOneBackup)
		.mutation(async ({ input, ctx }) => {
			try {
				const backup = await findBackupById(input.backupId);
				const backupOrgId = await getBackupOrganizationId(backup);
				assertOrgMatch(backupOrgId, ctx.session.activeOrganizationId);

				const postgres = await findPostgresByBackupId(backup.backupId);
				await runPostgresBackup(postgres as any, backup);

				await keepLatestNBackups(backup, (postgres as any)?.serverId);
				return true;
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: "Error running manual Postgres backup ";
				throw new TRPCError({
					code: "BAD_REQUEST",
					message,
				});
			}
		}),

	manualBackupWebServer: protectedProcedure
		.input(apiFindOneBackup)
		.mutation(async ({ input, ctx }) => {
			try {
				const backup = await findBackupById(input.backupId);
				const backupOrgId = await getBackupOrganizationId(backup);
				assertOrgMatch(backupOrgId, ctx.session.activeOrganizationId);

				await runWebServerBackup(backup);

				await keepLatestNBackups(backup);
				return true;
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: "Error running manual Web Server backup ";
				throw new TRPCError({
					code: "BAD_REQUEST",
					message,
				});
			}
		}),

	manualBackupMySql: protectedProcedure
		.input(apiFindOneBackup)
		.mutation(async ({ input, ctx }) => {
			try {
				const backup = await findBackupById(input.backupId);
				const backupOrgId = await getBackupOrganizationId(backup);
				assertOrgMatch(backupOrgId, ctx.session.activeOrganizationId);

				const mysql = await findMySqlByBackupId(backup.backupId);
				await runMySqlBackup(mysql as any, backup);
				await keepLatestNBackups(backup, (mysql as any)?.serverId);
				return true;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error running manual MySQL backup ",
					cause: error,
				});
			}
		}),
	manualBackupMariadb: protectedProcedure
		.input(apiFindOneBackup)
		.mutation(async ({ input, ctx }) => {
			try {
				const backup = await findBackupById(input.backupId);
				const backupOrgId = await getBackupOrganizationId(backup);
				assertOrgMatch(backupOrgId, ctx.session.activeOrganizationId);

				const mariadb = await findMariadbByBackupId(backup.backupId);
				await runMariadbBackup(mariadb as any, backup);
				await keepLatestNBackups(backup, (mariadb as any)?.serverId);
				return true;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error running manual Mariadb backup ",
					cause: error,
				});
			}
		}),
	manualBackupCompose: protectedProcedure
		.input(apiFindOneBackup)
		.mutation(async ({ input, ctx }) => {
			try {
				const backup = await findBackupById(input.backupId);
				const backupOrgId = await getBackupOrganizationId(backup);
				assertOrgMatch(backupOrgId, ctx.session.activeOrganizationId);

				const compose = await findComposeByBackupId(backup.backupId);
				await runComposeBackup(compose as any, backup);
				await keepLatestNBackups(backup, (compose as any)?.serverId);
				return true;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error running manual Compose backup ",
					cause: error,
				});
			}
		}),
	manualBackupMongo: protectedProcedure
		.input(apiFindOneBackup)
		.mutation(async ({ input, ctx }) => {
			try {
				const backup = await findBackupById(input.backupId);
				const backupOrgId = await getBackupOrganizationId(backup);
				assertOrgMatch(backupOrgId, ctx.session.activeOrganizationId);

				const mongo = await findMongoByBackupId(backup.backupId);
				await runMongoBackup(mongo as any, backup);
				await keepLatestNBackups(backup, (mongo as any)?.serverId);
				return true;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error running manual Mongo backup ",
					cause: error,
				});
			}
		}),
	manualBackupLibsql: protectedProcedure
		.input(apiFindOneBackup)
		.mutation(async ({ input, ctx }) => {
			const backup = await findBackupById(input.backupId);
			const backupOrgId = await getBackupOrganizationId(backup);
			assertOrgMatch(backupOrgId, ctx.session.activeOrganizationId);

			await runWebServerBackup(backup);
			return true;
		}),
	listBackupFiles: withPermission("backup", "read")
		.input(
			z.object({
				destinationId: z.string(),
				search: z.string(),
				serverId: z.string().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			try {
				const destination = await findDestinationById(input.destinationId);
				if (destination.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to access this destination",
					});
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
				console.error("Error in listBackupFiles:", error);
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Error listing backup files",
					cause: error,
				});
			}
		}),

	restoreBackupWithLogs: protectedProcedure
		.meta({
			openapi: {
				enabled: false,
				path: "/restore-backup-with-logs",
				method: "POST",
				override: true,
			},
		})
		.input(apiRestoreBackup)
		.subscription(async function* ({ input, ctx, signal }) {
			const destination = await findDestinationById(input.destinationId);
			if (destination.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to access this destination",
				});
			}

			const queue: string[] = [];
			let done = false;
			const onLog = (log: string) => {
				queue.push(log);
			};
			const finish = (run: Promise<unknown>) => {
				run
					.catch(() => {})
					.finally(() => {
						done = true;
					});
			};

			if (input.backupType === "database") {
				if (input.databaseType === "postgres") {
					const postgres = await findPostgresById(input.databaseId);
					finish(restorePostgresBackup(postgres, destination, input, onLog));
				} else if (input.databaseType === "mysql") {
					const mysql = await findMySqlById(input.databaseId);
					finish(restoreMySqlBackup(mysql, destination, input, onLog));
				} else if (input.databaseType === "mariadb") {
					const mariadb = await findMariadbById(input.databaseId);
					finish(restoreMariadbBackup(mariadb, destination, input, onLog));
				} else if (input.databaseType === "mongo") {
					const mongo = await findMongoById(input.databaseId);
					finish(restoreMongoBackup(mongo, destination, input, onLog));
				} else if (input.databaseType === "web-server") {
					finish(restoreWebServerBackup(destination, input.backupFile, onLog));
				} else {
					done = true;
				}
			} else if (input.backupType === "compose") {
				const compose = await findComposeById(input.databaseId);
				finish(restoreComposeBackup(compose, destination, input, onLog));
			} else {
				done = true;
			}

			while (!done || queue.length > 0) {
				if (queue.length > 0) {
					yield queue.shift()!;
				} else {
					await new Promise((r) => setTimeout(r, 50));
				}

				if (signal?.aborted) {
					return;
				}
			}
		}),
});
