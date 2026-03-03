import type { WriteStream } from "node:fs";
import type { ApplicationNested } from "../builders";
import { spawnAsync } from "../process/spawnAsync";

/**
 * Upload an image to a registry
 * Local-only implementation (multi-node functionality has been removed)
 */
export const uploadImage = async (
	application: ApplicationNested,
	writeStream: WriteStream,
) => {
	const registry = application.registry;

	if (!registry) {
		throw new Error("Registry not found");
	}

	const { registryUrl, imagePrefix } = registry;
	const { appName } = application;
	const imageName = `${appName}:latest`;

	const finalURL = registryUrl;

	// Fix: Don't use path.join for URLs - construct registry tag properly
	const registryTag = [registryUrl, imagePrefix, imageName]
		.filter(Boolean)
		.join('/')
		.replace(/\/+/g, '/');

	try {
		writeStream.write(
			`📦 [Enabled Registry] Uploading image to ${registry.registryType} | ${imageName} | ${finalURL}\n`,
		);
		const loginCommand = spawnAsync(
			"docker",
			["login", finalURL, "-u", registry.username, "--password-stdin"],
			(data) => {
				if (writeStream.writable) {
					writeStream.write(data);
				}
			},
		);
		loginCommand.child?.stdin?.write(registry.password);
		loginCommand.child?.stdin?.end();
		await loginCommand;

		await spawnAsync("docker", ["tag", imageName, registryTag], (data) => {
			if (writeStream.writable) {
				writeStream.write(data);
			}
		});

		await spawnAsync("docker", ["push", registryTag], (data) => {
			if (writeStream.writable) {
				writeStream.write(data);
			}
		});
	} catch (error) {
		console.log(error);
		throw error;
	}
};

/**
 * Stub implementation to maintain compatibility
 * Multi-node functionality has been removed
 */
export const uploadImageRemoteCommand = (
	application: ApplicationNested,
	logPath: string,
) => {
	console.warn("Multi-node functionality has been removed. Use local upload instead.");
	return "echo 'Multi-node functionality has been removed. Use local upload instead.' >> " + logPath;
};
