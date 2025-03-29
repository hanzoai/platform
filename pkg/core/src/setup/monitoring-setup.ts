// import { findServerById } from "@hanzo/core/services/server";
import type { ContainerCreateOptions } from "dockerode";
import { IS_CLOUD, docker } from "../constants";
import { findUserById } from "../services/admin";
import { getHanzoImageTag } from "../services/settings";
import { pullImage } from "../utils/docker/utils";
import { execAsync } from "../utils/process/execAsync";

/**
 * Stub implementation to maintain compatibility
 * Multi-server functionality has been removed
 */
export const setupMonitoring = async (_serverId: string) => {
	console.warn("Multi-server functionality has been removed. Use setupWebMonitoring instead.");
	// Forward to web monitoring setup with default settings
	const containerName = "hanzo-monitoring";
	let imageName = "hanzo/monitoring:latest";

	if (
		(getHanzoImageTag() !== "latest" ||
			process.env.NODE_ENV === "development") &&
		!IS_CLOUD
	) {
		imageName = "hanzo/monitoring:canary";
	}

	const settings: ContainerCreateOptions = {
		name: containerName,
		Env: [`METRICS_CONFIG=${JSON.stringify({})}`],
		Image: imageName,
		HostConfig: {
			PortBindings: {
				[`4500/tcp`]: [
					{
						HostPort: "4500",
					},
				],
			},
			Binds: [
				"/var/run/docker.sock:/var/run/docker.sock:ro",
				"/sys:/host/sys:ro",
				"/etc/os-release:/etc/os-release:ro",
				"/proc:/host/proc:ro",
				"/etc/hanzo/monitoring/monitoring.db:/app/monitoring.db",
			],
			NetworkMode: "host",
		},
		ExposedPorts: {
			[`4500/tcp`]: {},
		},
	};

	try {
		await execAsync(
			"mkdir -p /etc/hanzo/monitoring && touch /etc/hanzo/monitoring/monitoring.db",
		);
		await pullImage(imageName);

		// Check if container exists
		const container = docker.getContainer(containerName);
		try {
			await container.inspect();
			await container.remove({ force: true });
			console.log("Removed existing container");
		} catch (_error) {
			// Container doesn't exist, continue
		}

		await docker.createContainer(settings);
		const newContainer = docker.getContainer(containerName);
		await newContainer.start();

		console.log("Monitoring Started ");
	} catch (error) {
		console.log("Monitoring Not Found: Starting ", error);
	}
};

export const setupWebMonitoring = async (userId: string) => {
	const user = await findUserById(userId);

	const containerName = "hanzo-monitoring";
	let imageName = "hanzo/monitoring:latest";

	if (
		(getHanzoImageTag() !== "latest" ||
			process.env.NODE_ENV === "development") &&
		!IS_CLOUD
	) {
		imageName = "hanzo/monitoring:canary";
	}

	const settings: ContainerCreateOptions = {
		name: containerName,
		Env: [`METRICS_CONFIG=${JSON.stringify(user?.metricsConfig)}`],
		Image: imageName,
		HostConfig: {
			// Memory: 100 * 1024 * 1024, // 100MB en bytes
			// PidMode: "host",
			// CapAdd: ["NET_ADMIN", "SYS_ADMIN"],
			// Privileged: true,
			PortBindings: {
				[`${user?.metricsConfig?.server?.port}/tcp`]: [
					{
						HostPort: user?.metricsConfig?.server?.port.toString(),
					},
				],
			},
			Binds: [
				"/var/run/docker.sock:/var/run/docker.sock:ro",
				"/sys:/host/sys:ro",
				"/etc/os-release:/etc/os-release:ro",
				"/proc:/host/proc:ro",
				"/etc/hanzo/monitoring/monitoring.db:/app/monitoring.db",
			],
			// NetworkMode: "host",
		},
		ExposedPorts: {
			[`${user?.metricsConfig?.server?.port}/tcp`]: {},
		},
	};
	const docker = await getRemoteDocker();
	try {
		await execAsync(
			"mkdir -p /etc/hanzo/monitoring && touch /etc/hanzo/monitoring/monitoring.db",
		);
		await pullImage(imageName);

		const container = docker.getContainer(containerName);
		try {
			await container.inspect();
			await container.remove({ force: true });
			console.log("Removed existing container");
		} catch (_error) {}

		await docker.createContainer(settings);
		const newContainer = docker.getContainer(containerName);
		await newContainer.start();

		console.log("Monitoring Started ");
	} catch (error) {
		console.log("Monitoring Not Found: Starting ", error);
	}
};
