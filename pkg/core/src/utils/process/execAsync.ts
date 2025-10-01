import { exec, execFile } from "node:child_process";
import util from "node:util";
export const execAsync = util.promisify(exec);

/**
 * Execute command with streaming output
 */
export const execAsyncStream = async (
	command: string,
	onData?: (data: string) => void,
): Promise<{ stdout: string; stderr: string }> => {
	return new Promise((resolve, reject) => {
		const child = exec(command);
		let stdout = '';
		let stderr = '';

		child.stdout?.on('data', (data) => {
			stdout += data;
			if (onData) onData(data);
		});

		child.stderr?.on('data', (data) => {
			stderr += data;
			if (onData) onData(data);
		});

		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`Command failed with exit code ${code}`));
			} else {
				resolve({ stdout, stderr });
			}
		});
	});
};

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

export const execFileAsync = async (
	command: string,
	args: string[],
	options: { input?: string } = {},
): Promise<{ stdout: string; stderr: string }> => {
	const child = execFile(command, args);

	if (options.input && child.stdin) {
		child.stdin.write(options.input);
		child.stdin.end();
	}

	return new Promise((resolve, reject) => {
		let stdout = "";
		let stderr = "";

		child.stdout?.on("data", (data) => {
			stdout += data.toString();
		});

		child.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		child.on("close", (code) => {
			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				reject(
					new Error(`Command failed with code ${code}. Stderr: ${stderr}`),
				);
			}
		});

		child.on("error", reject);
	});
};

export const sleep = (ms: number) => {
	return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Kill a process and all its children
 * @param pid Process ID to kill
 * @param signal Signal to send (default: SIGTERM)
 */
export const killProcess = async (pid: number, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> => {
	try {
		// Kill the process group (negative PID kills all processes in the group)
		process.kill(-pid, signal);
		console.log(`Killed process group ${pid} with signal ${signal}`);
	} catch (error: any) {
		if (error.code === 'ESRCH') {
			// Process doesn't exist, which is fine
			console.log(`Process ${pid} does not exist`);
		} else {
			throw error;
		}
	}
};

/**
 * Kill a remote process (stub implementation)
 * Multi-server functionality has been removed
 */
export const killRemoteProcess = async (
	_serverId: string | null,
	pid: number,
	signal: NodeJS.Signals = 'SIGTERM'
): Promise<void> => {
	console.warn("Multi-server functionality has been removed. Killing process locally.");
	await killProcess(pid, signal);
};
