import { exit } from "node:process";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import { setupDirectories } from "@hanzo/platform/setup/config-paths";
import { initializeRedis } from "@hanzo/platform/setup/redis-setup";
import {
	initializeNetwork,
	initializeSwarm,
} from "@hanzo/platform/setup/setup";
import {
	createDefaultMiddlewares,
	createDefaultServerTraefikConfig,
	createDefaultTraefikConfig,
	initializeStandaloneTraefik,
	TRAEFIK_VERSION,
} from "@hanzo/platform/setup/traefik-setup";

(async () => {
	try {
		setupDirectories();
		createDefaultMiddlewares();
		await initializeSwarm();
		await initializeNetwork();
		createDefaultTraefikConfig();
		createDefaultServerTraefikConfig();
		await execAsync("docker pull ghcr.io/hanzoai/ingress:latest");
		await initializeStandaloneTraefik();
		await initializeRedis();
		console.log("Hanzo Platform setup completed");
		exit(0);
	} catch (e) {
		console.error("Error in platform setup", e);
	}
})();
