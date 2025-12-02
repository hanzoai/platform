import { exit } from "node:process";
import { execAsync } from "@hanzo/platform";
import { setupDirectories } from "@hanzo/platform/setup/config-paths";
import { initializePostgres } from "@hanzo/platform/setup/postgres-setup";
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
} from "@hanzo/platform/setup/traefik-setup";

(async () => {
	try {
		setupDirectories();
		createDefaultMiddlewares();
		await initializeSwarm();
		await initializeNetwork();
		createDefaultTraefikConfig();
		createDefaultServerTraefikConfig();
		await execAsync("docker pull traefik:v3.6.1");
		await initializeStandaloneTraefik();
		await initializeRedis();
		await initializePostgres();
		console.log("Dokploy setup completed");
		exit(0);
	} catch (e) {
		console.error("Error in dokploy setup", e);
	}
})();
