import {
	createDefaultMiddlewares,
	createDefaultServerTraefikConfig,
	createDefaultTraefikConfig,
	initializeTraefik,
} from "@hanzo/core/setup/traefik-setup";

import { setupDirectories } from "@hanzo/core/setup/config-paths";
import { initializePostgres } from "@hanzo/core/setup/postgres-setup";
import { initializeRedis } from "@hanzo/core/setup/redis-setup";
import { initializeNetwork, initializeSwarm } from "@hanzo/core/setup/setup";
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
