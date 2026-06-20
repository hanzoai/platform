import {
	CLEANUP_CRON_JOB,
	cleanupAll,
	findBackupById,
	findScheduleById,
	findServerById,
	findVolumeBackupById,
	keepLatestNBackups,
	runCommand,
	runComposeBackup,
	runLibsqlBackup,
	runMariadbBackup,
	runMongoBackup,
	runMySqlBackup,
	runPostgresBackup,
	runVolumeBackup,
} from "@hanzo/platform";
import {
	and,
	backups,
	db,
	eq,
	schedules,
	server,
	volumeBackups,
} from "@hanzo/platform/db";
import {
	readDeclaredTag,
	readLatestTag,
	readReleaseMeta,
	readRunningTag,
} from "@hanzo/platform/services/apps/index";
import { APPS_READER_CRONS } from "./apps-readers.js";
import { logger } from "./logger.js";
import { scheduleJob } from "./queue.js";
import type { QueueJob } from "./schema.js";

export const runJobs = async (job: QueueJob) => {
	try {
		if (job.type === "backup") {
			const { backupId } = job;
			const backup = await findBackupById(backupId);
			const {
				databaseType,
				postgres,
				mysql,
				mongo,
				mariadb,
				libsql,
				compose,
				backupType,
			} = backup;

			if (backupType === "database") {
				if (databaseType === "postgres" && postgres) {
					const server = await findServerById(postgres.serverId as string);
					if (server.serverStatus === "inactive") {
						logger.info("Server is inactive");
						return;
					}
					await runPostgresBackup(postgres, backup);
					await keepLatestNBackups(backup, server.serverId);
				} else if (databaseType === "mysql" && mysql) {
					const server = await findServerById(mysql.serverId as string);
					if (server.serverStatus === "inactive") {
						logger.info("Server is inactive");
						return;
					}
					await runMySqlBackup(mysql, backup);
					await keepLatestNBackups(backup, server.serverId);
				} else if (databaseType === "mongo" && mongo) {
					const server = await findServerById(mongo.serverId as string);
					if (server.serverStatus === "inactive") {
						logger.info("Server is inactive");
						return;
					}
					await runMongoBackup(mongo, backup);
					await keepLatestNBackups(backup, server.serverId);
				} else if (databaseType === "mariadb" && mariadb) {
					const server = await findServerById(mariadb.serverId as string);
					if (server.serverStatus === "inactive") {
						logger.info("Server is inactive");
						return;
					}
					await runMariadbBackup(mariadb, backup);
					await keepLatestNBackups(backup, server.serverId);
				} else if (databaseType === "libsql" && libsql) {
					const server = await findServerById(libsql.serverId as string);
					if (server.serverStatus === "inactive") {
						logger.info("Server is inactive");
						return;
					}
					await runLibsqlBackup(libsql, backup);
					await keepLatestNBackups(backup, server.serverId);
				}
			} else if (backupType === "compose" && compose) {
				const server = await findServerById(compose.serverId as string);
				if (server.serverStatus === "inactive") {
					logger.info("Server is inactive");
					return;
				}
				await runComposeBackup(compose, backup);
				await keepLatestNBackups(backup, server.serverId);
			}
		} else if (job.type === "server") {
			const { serverId } = job;
			const server = await findServerById(serverId);
			if (server.serverStatus === "inactive") {
				logger.info("Server is inactive");
				return;
			}
			await cleanupAll(serverId);
		} else if (job.type === "schedule") {
			const { scheduleId } = job;
			const schedule = await findScheduleById(scheduleId);
			if (schedule.enabled) {
				await runCommand(schedule.scheduleId);
			}
		} else if (job.type === "volume-backup") {
			const { volumeBackupId } = job;
			const volumeBackup = await findVolumeBackupById(volumeBackupId);
			if (volumeBackup.enabled) {
				await runVolumeBackup(volumeBackupId);
			}
		} else if (job.type === "read-latest-tag") {
			await readLatestTag();
		} else if (job.type === "read-declared-tag") {
			await readDeclaredTag();
		} else if (job.type === "read-running-tag") {
			await readRunningTag();
		} else if (job.type === "read-release-meta") {
			await readReleaseMeta();
		}
	} catch (error) {
		logger.error(error);
	}

	return true;
};

export const initializeJobs = async () => {
	logger.info("Setting up Jobs....");

	const servers = await db.query.server.findMany({
		where: and(
			eq(server.enableDockerCleanup, true),
			eq(server.serverStatus, "active"),
		),
	});

	for (const server of servers) {
		const { serverId } = server;
		try {
			await scheduleJob({
				serverId,
				type: "server",
				cronSchedule: CLEANUP_CRON_JOB,
			});
		} catch (error) {
			logger.error(
				error,
				`Failed to schedule cleanup job for server ${serverId}`,
			);
		}
	}

	logger.info({ Quantity: servers.length }, "Active Servers Initialized");

	const backupsResult = await db.query.backups.findMany({
		where: eq(backups.enabled, true),
		with: {
			mariadb: true,
			mysql: true,
			postgres: true,
			mongo: true,
			libsql: true,
			compose: true,
		},
	});

	for (const backup of backupsResult) {
		try {
			await scheduleJob({
				backupId: backup.backupId,
				type: "backup",
				cronSchedule: backup.schedule,
			});
		} catch (error) {
			logger.error(error, `Failed to schedule backup ${backup.backupId}`);
		}
	}
	logger.info({ Quantity: backupsResult.length }, "Backups Initialized");

	const schedulesResult = await db.query.schedules.findMany({
		where: eq(schedules.enabled, true),
		with: {
			application: {
				with: {
					server: true,
				},
			},
			compose: {
				with: {
					server: true,
				},
			},
			server: true,
		},
	});

	const filteredSchedulesBasedOnServerStatus = schedulesResult.filter(
		(schedule) => {
			if (schedule.server) {
				return schedule.server.serverStatus === "active";
			}
			if (schedule.application) {
				return schedule.application.server?.serverStatus === "active";
			}
			if (schedule.compose) {
				return schedule.compose.server?.serverStatus === "active";
			}
		},
	);

	for (const schedule of filteredSchedulesBasedOnServerStatus) {
		try {
			await scheduleJob({
				scheduleId: schedule.scheduleId,
				type: "schedule",
				cronSchedule: schedule.cronExpression,
			});
		} catch (error) {
			logger.error(error, `Failed to schedule ${schedule.scheduleId}`);
		}
	}
	logger.info(
		{ Quantity: filteredSchedulesBasedOnServerStatus.length },
		"Schedules Initialized",
	);

	const volumeBackupsResult = await db.query.volumeBackups.findMany({
		where: eq(volumeBackups.enabled, true),
		with: {
			application: {
				with: {
					server: true,
				},
			},
			compose: {
				with: {
					server: true,
				},
			},
		},
	});

	const filteredVolumeBackupsBasedOnServerStatus = volumeBackupsResult.filter(
		(volumeBackup) => {
			if (volumeBackup.application) {
				return volumeBackup.application.server?.serverStatus === "active";
			}
			if (volumeBackup.compose) {
				return volumeBackup.compose.server?.serverStatus === "active";
			}
		},
	);

	for (const volumeBackup of filteredVolumeBackupsBasedOnServerStatus) {
		try {
			await scheduleJob({
				volumeBackupId: volumeBackup.volumeBackupId,
				type: "volume-backup",
				cronSchedule: volumeBackup.cronExpression,
			});
		} catch (error) {
			logger.error(
				error,
				`Failed to schedule volume backup ${volumeBackup.volumeBackupId}`,
			);
		}
	}

	logger.info(
		{ Quantity: filteredVolumeBackupsBasedOnServerStatus.length },
		"Volume Backups Initialized",
	);

	// apps-lifecycle readers (PR 2 of docs/APPS_LIFECYCLE.md): four singleton
	// repeatable jobs, each on its OWN cron. They sweep the whole apps table, so
	// they take no id and are registered unconditionally (not gated on any DB
	// row). cleanQueue() ran at boot, so this re-registers them fresh each start.
	for (const reader of APPS_READER_CRONS) {
		try {
			await scheduleJob({
				type: reader.type,
				cronSchedule: reader.cronSchedule,
			});
		} catch (error) {
			logger.error(error, `Failed to schedule apps reader ${reader.type}`);
		}
	}
	logger.info(
		{ Quantity: APPS_READER_CRONS.length },
		"Apps Lifecycle Readers Initialized",
	);
};
