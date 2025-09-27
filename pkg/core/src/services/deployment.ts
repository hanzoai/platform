import { existsSync, promises as fsPromises } from "node:fs";
import path from "node:path";
import { paths } from "@hanzo/platform/constants";
import { db } from "@hanzo/platform/db";
import {
	type apiCreateDeployment,
	deployments,
} from "@hanzo/platform/db/schema";
import { TRPCError } from "@trpc/server";
import { removeDirectoryIfExistsContent } from "@hanzo/platform/utils/filesystem/directory";
import { format } from "date-fns";
import { desc, eq } from "drizzle-orm";
import {
	type Application,
	findApplicationById,
	updateApplicationStatus,
} from "./application";

import { execAsyncRemote, killProcess, killRemoteProcess } from "@hanzo/platform/utils/process/execAsync";

export type Deployment = typeof deployments.$inferSelect;

export const findDeploymentById = async (applicationId: string) => {
	const application = await db.query.deployments.findFirst({
		where: eq(deployments.applicationId, applicationId),
		with: {
			application: true,
		},
	});
	if (!application) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Deployment not found",
		});
	}
	return application;
};

export const createDeployment = async (
	deployment: Omit<
		typeof apiCreateDeployment._type,
		"deploymentId" | "createdAt" | "status" | "logPath"
	>,
) => {
	const application = await findApplicationById(deployment.applicationId);

	try {
		await removeLastTenDeployments(
			deployment.applicationId,
			application.serverId,
		);
		const appName = application.appName;
		if (!appName) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "App name not found",
			});
		}
		const logFileName = `${appName}-${format(
			new Date(),
			"yyyy-MM-dd'T'HH:mm:ss",
		)}.log`;
		const logFileNameCron = `${appName}-CRON-${format(
			new Date(),
			"yyyy-MM-dd'T'HH:mm:ss",
		)}.log`;

		const pathFolder = path.join(paths().LOGS_PATH, appName);

		const logPath = path.join(
			pathFolder,
			deployment.type === "job" ? logFileNameCron : logFileName,
		);

		const newDeployment = await db
			.insert(deployments)
			.values({
				...deployment,
				logPath: logPath,
			})
			.returning()
			.then((res) => res[0]);

		if (!newDeployment) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Error to create the deployment",
			});
		}

		return newDeployment;
	} catch (error) {
		console.log(error);
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Error to create this deployment",
		});
	}
};

export const removeDeploymentById = async (
	deploymentId: string,
	serverId: string,
) => {
	const deploymentResponse = await db
		.select()
		.from(deployments)
		.where(eq(deployments.deploymentId, deploymentId))
		.limit(1);

	const deployment = deploymentResponse[0];
	if (!deployment) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Deployment not found",
		});
	}

	const logPath = deployment.logPath;

	try {
		if (serverId === "local") {
			if (logPath) {
				const directory = path.dirname(logPath);
				const fileName = path.basename(logPath);
				await removeDirectoryIfExistsContent(directory, fileName);
			}
		} else {
			if (logPath) {
				const directory = path.dirname(logPath);
				const fileName = path.basename(logPath);

				await execAsyncRemote(
					serverId,
					`rm -f ${path.join(directory, fileName)}`,
				);
			}
		}

		await db.delete(deployments).where(eq(deployments.deploymentId, deploymentId));
	} catch (error) {
		console.log(error);
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Error to remove this deployment",
		});
	}
};

export const removeLastTenDeployments = async (
	applicationId: string,
	serverId: string,
) => {
	const deploymentsToKeep = await db
		.select()
		.from(deployments)
		.where(eq(deployments.applicationId, applicationId))
		.orderBy(desc(deployments.createdAt))
		.limit(10);

	const deploymentIdsToKeep = deploymentsToKeep.map(
		(d) => d.deploymentId,
	);

	const deploymentsToDelete = await db
		.select()
		.from(deployments)
		.where(eq(deployments.applicationId, applicationId));

	const deploymentsToRemove = deploymentsToDelete.filter(
		(d) => !deploymentIdsToKeep.includes(d.deploymentId),
	);

	for (const deployment of deploymentsToRemove) {
		await removeDeploymentById(deployment.deploymentId, serverId);
	}
};

export const getDeploymentsByApplicationId = async (
	applicationId: string,
) => {
	const deploymentsResponse = await db
		.select()
		.from(deployments)
		.where(eq(deployments.applicationId, applicationId))
		.orderBy(desc(deployments.createdAt));

	return deploymentsResponse;
};

export const getDeploymentsByServerId = async (serverId: string) => {
	const deploymentsResponse = await db.query.deployments.findMany({
		with: {
			application: true,
		},
		orderBy: desc(deployments.createdAt),
		where: eq(deployments.serverId, serverId),
	});

	return deploymentsResponse;
};

export const updateDeploymentById = async (
	deploymentId: string,
	deploymentData: Partial<Deployment>,
) => {
	try {
		const updatedDeployment = await db
			.update(deployments)
			.set(deploymentData)
			.where(eq(deployments.deploymentId, deploymentId))
			.returning();
		return updatedDeployment[0];
	} catch (error) {
		throw error;
	}
};

export const updateDeploymentStatus = async (
	deploymentId: string,
	deploymentStatus: Deployment["status"],
) => {
	try {
		const updatedDeployment = await db
			.update(deployments)
			.set({ status: deploymentStatus })
			.where(eq(deployments.deploymentId, deploymentId))
			.returning();
		return updatedDeployment[0];
	} catch (error) {
		throw error;
	}
};

/**
 * Implementation for local server deployment functionality
 * Remote server deployment functionality has been removed
 */
export const createServerDeployment = async ({
	serverId,
	title,
	description
}: {
	serverId: string,
	title: string,
	description: string
}) => {
	if (serverId !== "local") {
		throw new Error("Multi-server functionality has been removed. Only local server deployment is supported.");
	}

	// Create a placeholder deployment for the local server setup process
	try {
		const deploymentCreate = await db
			.insert(deployments)
			.values({
				applicationId: "local-server", // Using a dummy applicationId for server setup
				title: title || "Local Server Setup",
				description: description || "Setting up local server environment",
				status: "running",
				logPath: path.join(paths().LOGS_PATH, "local-server", "setup.log"),
			})
			.returning();

		if (deploymentCreate.length === 0 || !deploymentCreate[0]) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Error creating the deployment",
			});
		}

		return deploymentCreate[0];
	} catch (error) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Error creating server deployment: ${error instanceof Error ? error.message : String(error)}`,
		});
	}
};

/**
 * Kill a deployment process
 * @param deploymentId - The deployment ID to kill
 * @returns The updated deployment
 */
export const killDeploymentProcess = async (deploymentId: string) => {
	const deployment = await db.query.deployments.findFirst({
		where: eq(deployments.deploymentId, deploymentId),
		with: {
			application: true,
		},
	});

	if (!deployment) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Deployment not found",
		});
	}

	if (!deployment.pid) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "No process ID found for this deployment",
		});
	}

	if (deployment.status !== "running") {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Deployment is not running",
		});
	}

	try {
		// Kill the process
		if (deployment.application?.serverId) {
			await killRemoteProcess(deployment.application.serverId, deployment.pid);
		} else {
			await killProcess(deployment.pid);
		}

		// Update deployment status
		const updatedDeployment = await db
			.update(deployments)
			.set({
				status: "error",
				errorMessage: "Process killed by user",
			})
			.where(eq(deployments.deploymentId, deploymentId))
			.returning();

		// Update application status if applicable
		if (deployment.applicationId) {
			await updateApplicationStatus(deployment.applicationId, "error");
		}

		return updatedDeployment[0];
	} catch (error) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: `Failed to kill process: ${error instanceof Error ? error.message : "Unknown error"}`,
		});
	}
};

export const createDeploymentBackup = async (
	deployment: Omit<
		any,
		"deploymentId" | "createdAt" | "status" | "logPath"
	>,
) => {
	try {
		const backupId = deployment.backupId;
		const logFileName = `backup-${format(
			new Date(),
			"yyyy-MM-dd'T'HH:mm:ss",
		)}.log`;

		const pathFolder = path.join(paths().LOGS_PATH, "backups");
		const logPath = path.join(pathFolder, logFileName);

		const newDeployment = await db
			.insert(deployments)
			.values({
				...deployment,
				applicationId: backupId, // Using backupId as applicationId for backups
				logPath: logPath,
				type: "backup",
			})
			.returning()
			.then((res) => res[0]);

		if (!newDeployment) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Error creating the backup deployment",
			});
		}

		return newDeployment;
	} catch (error) {
		console.error("Error creating backup deployment:", error);
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Error creating backup deployment",
		});
	}
};

export const createDeploymentPreview = async (
	applicationId: string,
	title: string,
	description: string,
	previewDeploymentId: string,
) => {
	const application = await findApplicationById(applicationId);

	const deployment = await createDeployment({
		applicationId,
		title,
		description,
		type: "deploy",
		previewDeploymentId,
	});

	return deployment;
};

export const removeDeploymentsByPreviewDeploymentId = async (
	previewDeployment: any,
	serverId: string,
) => {
	try {
		// Find all deployments associated with this preview deployment
		const deploymentsToRemove = await db.query.deployments.findMany({
			where: eq(deployments.previewDeploymentId, previewDeployment.previewDeploymentId),
		});

		// Remove deployment directories
		for (const deployment of deploymentsToRemove) {
			const logPath = deployment.logPath;
			if (logPath && existsSync(logPath)) {
				await fsPromises.rm(path.dirname(logPath), { recursive: true, force: true });
			}
		}

		// Delete deployments from database
		await db
			.delete(deployments)
			.where(eq(deployments.previewDeploymentId, previewDeployment.previewDeploymentId));

		return true;
	} catch (error) {
		console.error("Error removing deployments for preview deployment:", error);
		throw error;
	}
};