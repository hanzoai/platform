import { existsSync, promises as fsPromises } from "node:fs";
import path from "node:path";
import { paths } from "@hanzo/core/constants";
import { db } from "@hanzo/core/db";
import {
	type apiCreateDeployment,
	deployments,
} from "@hanzo/core/db/schema";
import { TRPCError } from "@trpc/server";
import { removeDirectoryIfExistsContent } from "@hanzo/core/utils/filesystem/directory";
import { format } from "date-fns";
import { desc, eq } from "drizzle-orm";
import {
	type Application,
	findApplicationById,
	updateApplicationStatus,
} from "./application";

import { execAsyncRemote, killProcess, killRemoteProcess } from "@hanzo/core/utils/process/execAsync";

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

		const { LOGS_PATH } = paths(!!application.serverId);
		const formattedDateTime = format(new Date(), "yyyy-MM-dd:HH:mm:ss");
		const fileName = `${application.appName}-${formattedDateTime}.log`;
		const logFilePath = path.join(LOGS_PATH, application.appName, fileName);

		if (application.serverId) {
			const command = `
mkdir -p ${LOGS_PATH}/${application.appName};
echo "Initializing deployment" >> ${logFilePath};
`;

			await execAsyncRemote(application.serverId, command);
		} else {
			await fsPromises.mkdir(path.join(LOGS_PATH, application.appName), {
				recursive: true,
			});
			await fsPromises.writeFile(logFilePath, "Initializing deployment");
		}

		const deploymentCreate = await db
			.insert(deployments)
			.values({
				applicationId: deployment.applicationId,
				title: deployment.title || "Deployment",
				description: deployment.description || "",
				status: "running",
				logPath: logFilePath,
			})
			.returning();

		if (deploymentCreate.length === 0 || !deploymentCreate[0]) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Error creating the deployment",
			});
		}

		await updateApplicationStatus(deployment.applicationId, "running");

		return deploymentCreate[0];
	} catch (error) {
		await db
			.insert(deployments)
			.values({
				applicationId: deployment.applicationId,
				title: deployment.title || "Deployment",
				status: "error",
				logPath: "",
				description: deployment.description || "",
				errorMessage: `An error have occured: ${error instanceof Error ? error.message : error
					}`,
			})
			.returning();
		await updateApplicationStatus(deployment.applicationId, "error");
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Error creating the deployment",
		});
	}
};

export const removeDeployment = async (deploymentId: string) => {
	try {
		const deployment = await db
			.delete(deployments)
			.where(eq(deployments.deploymentId, deploymentId))
			.returning();
		return deployment[0];
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Error creating the deployment";
		throw new TRPCError({
			code: "BAD_REQUEST",
			message,
		});
	}
};

export const removeDeploymentsByApplicationId = async (
	applicationId: string,
) => {
	await db
		.delete(deployments)
		.where(eq(deployments.applicationId, applicationId))
		.returning();
};

export const removeLastTenDeployments = async (
	applicationId: string,
	serverId: string | null,
) => {
	const deploymentList = await db.query.deployments.findMany({
		where: eq(deployments.applicationId, applicationId),
		orderBy: [desc(deployments.createdAt)],
	});

	if (deploymentList.length > 10) {
		const deploymentsToDelete = deploymentList.slice(9);
		if (serverId) {
			let command = "";
			for (const oldDeployment of deploymentsToDelete) {
				const logPath = path.join(oldDeployment.logPath);

				command += `
				rm -rf ${logPath};
				`;
				await removeDeployment(oldDeployment.deploymentId);
			}

			await execAsyncRemote(serverId, command);
		} else {
			for (const oldDeployment of deploymentsToDelete) {
				const logPath = path.join(oldDeployment.logPath);
				if (existsSync(logPath)) {
					await fsPromises.unlink(logPath);
				}
				await removeDeployment(oldDeployment.deploymentId);
			}
		}
	}
};

export const removeDeployments = async (application: Application) => {
	const { LOGS_PATH } = paths();
	const { appName } = application;
	const logsPath = path.join(LOGS_PATH, appName);
	await removeDirectoryIfExistsContent(logsPath);
	await db
		.delete(deployments)
		.where(eq(deployments.applicationId, application.applicationId))
		.returning();
};

export const findAllDeploymentsByApplicationId = async (
	applicationId: string,
) => {
	const deploymentsList = await db.query.deployments.findMany({
		where: eq(deployments.applicationId, applicationId),
		orderBy: [desc(deployments.createdAt)],
	});
	return deploymentsList;
};

export const updateDeployment = async (
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
