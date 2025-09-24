import {
	createDefaultMiddlewares,
	createDefaultServerTraefikConfig,
	createDefaultTraefikConfig,
	initializeTraefik,
} from "@hanzo/platform/setup/traefik-setup";

import { setupDirectories } from "@hanzo/platform/setup/config-paths";
import { initializePostgres } from "@hanzo/platform/setup/postgres-setup";
import { initializeRedis } from "@hanzo/platform/setup/redis-setup";
import { initializeNetwork, initializeSwarm } from "@hanzo/platform/setup/setup";
(async () => {
	try {
		setupDirectories();
		createDefaultMiddlewares();
		await initializeSwarm();
		await initializeNetwork();
		createDefaultTraefikConfig();
		createDefaultServerTraefikConfig();
		await initializeTraefik();
		await initializeRedis();
		await initializePostgres();
	} catch (e) {
		console.error("Error in hanzo setup", e);
	}
})();
