import type { BackupSchedule } from "@hanzo/core/services/backup";
import type { Compose } from "@hanzo/core/services/compose";
import {
	createDeploymentBackup,
	updateDeploymentStatus,
} from "@hanzo/core/services/deployment";
import { findEnvironmentById } from "@hanzo/core/services/environment";
import { findProjectById } from "@hanzo/core/services/project";
import { sendDatabaseBackupNotifications } from "../notifications/database-backup";
import { execAsync, execAsyncRemote } from "../process/execAsync";
import { getBackupCommand, getS3Credentials, normalizeS3Path } from "./utils";

export const runComposeBackup = async (
	compose: Compose,
	backup: BackupSchedule,
) => {
	const { environmentId, name } = compose;
	const environment = await findEnvironmentById(environmentId);
	const project = await findProjectById(environment.projectId);
	const { prefix, databaseType } = backup;
	const destination = backup.destination;
	const backupFileName = `${new Date().toISOString()}.sql.gz`;
	const bucketDestination = `${normalizeS3Path(prefix)}${backupFileName}`;
	const deployment = await createDeploymentBackup({
		backupId: backup.backupId,
		title: "Compose Backup",
		description: "Compose Backup",
	});

	try {
		const rcloneFlags = getS3Credentials(destination);
		const rcloneDestination = `:s3:${destination.bucket}/${bucketDestination}`;
		const rcloneCommand = `rclone rcat ${rcloneFlags.join(" ")} "${rcloneDestination}"`;

		const backupCommand = getBackupCommand(
			backup,
			rcloneCommand,
			deployment.logPath,
		);
		if (compose.serverId) {
			await execAsyncRemote(compose.serverId, backupCommand);
		} else {
			await execAsync(backupCommand, {
				shell: "/bin/bash",
			});
		}

		await sendDatabaseBackupNotifications({
			applicationName: name,
			projectName: project.name,
			databaseType: getDatabaseType(databaseType),
			type: "success",
			organizationId: project.organizationId,
			databaseName: backup.database,
		});

		await updateDeploymentStatus(deployment.deploymentId, "done");
	} catch (error) {
		console.log(error);
		await sendDatabaseBackupNotifications({
			applicationName: name,
			projectName: project.name,
			databaseType: getDatabaseType(databaseType),
			type: "error",
			// @ts-ignore
			errorMessage: error?.message || "Error message not provided",
			organizationId: project.organizationId,
			databaseName: backup.database,
		});

		await updateDeploymentStatus(deployment.deploymentId, "error");
		throw error;
	}
};

const getDatabaseType = (databaseType: BackupSchedule["databaseType"]) => {
	if (databaseType === "mongo") {
		return "mongodb";
	}
	if (databaseType === "postgres") {
		return "postgres";
	}
	if (databaseType === "mariadb") {
		return "mariadb";
	}
	if (databaseType === "mysql") {
		return "mysql";
	}
	return "mongodb";
};
