import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execAsync, paths } from "@hanzo/platform";

export const getShell = () => {
	switch (os.platform()) {
		case "win32":
			return "powershell.exe";
		case "darwin":
			return "zsh";
		default:
			return "bash";
	}
};

/** Returns private SSH key for hanzo local server terminal. Uses already created SSH key or generates a new SSH key.
 */
export const setupLocalServerSSHKey = async () => {
	const { SSH_PATH } = paths(true);
	const sshKeyPath = path.join(SSH_PATH, "auto_generated-hanzo-local");

	if (!fs.existsSync(sshKeyPath)) {
		// Generate new SSH key if it hasn't been created yet
		await execAsync(
			`ssh-keygen -t rsa -b 4096 -f ${sshKeyPath} -N "" -C "hanzo-local-access"`,
		);
	}

	const privateKey = fs.readFileSync(sshKeyPath, "utf8");

	return privateKey;
};
