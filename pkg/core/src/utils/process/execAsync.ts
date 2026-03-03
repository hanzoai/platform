import { exec } from "node:child_process";
import util from "node:util";
export const execAsync = util.promisify(exec);

/**
 * Stub implementation that logs a warning and executes the command locally
 * Multi-server functionality has been removed
 */
export const execAsyncRemote = async (
	_serverId: string | null,
	command: string,
	onData?: (data: string) => void,
): Promise<{ stdout: string; stderr: string }> => {
	console.warn("Multi-server functionality has been removed. Executing command locally.");
	const { stdout, stderr } = await execAsync(command);
	if (onData) {
		onData(stdout);
		if (stderr) onData(stderr);
	}
	return { stdout, stderr };
};

export const sleep = (ms: number) => {
	return new Promise((resolve) => setTimeout(resolve, ms));
};
