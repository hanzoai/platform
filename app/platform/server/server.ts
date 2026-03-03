import http from "node:http";
import {
	createDefaultMiddlewares,
	createDefaultServerTraefikConfig,
	createDefaultTraefikConfig,
	IS_CLOUD,
	initCronJobs,
	initializeNetwork,
	initSchedules,
	initVolumeBackupsCronJobs,
	initCancelDeployments,
	sendHanzoRestartNotifications,
	setupDirectories,
	auth,
} from "@hanzo/platform";
import { config } from "dotenv";
import next from "next";
import { toNodeHandler } from "better-auth/node";
import { createNextApiHandler } from "@trpc/server/adapters/next";
import { migration } from "@/server/db/migration";
import { appRouter } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";
import { setupDockerContainerLogsWebSocketServer } from "./wss/docker-container-logs";
import { setupDockerContainerTerminalWebSocketServer } from "./wss/docker-container-terminal";
import { setupDockerStatsMonitoringSocketServer } from "./wss/docker-stats";
import { setupDrawerLogsWebSocketServer } from "./wss/drawer-logs";
import { setupDeploymentLogsWebSocketServer } from "./wss/listen-deployment";
import { setupTerminalWebSocketServer } from "./wss/terminal";

config({ path: ".env" });
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, turbopack: process.env.TURBOPACK === "1" });
const handle = app.getRequestHandler();

void app.prepare().then(async () => {
	try {
		// Create auth handler once
		const authHandler = toNodeHandler(auth.handler);

		// Create TRPC handler once
		const trpcHandler = createNextApiHandler({
			router: appRouter,
			createContext: createTRPCContext,
		});

		const server = http.createServer(async (req, res) => {
			// Handle better-auth routes
			if (req.url?.startsWith('/api/auth/')) {
				try {
					return await authHandler(req, res);
				} catch (error) {
					console.error('Auth error:', error);
					res.writeHead(500);
					res.end();
					return;
				}
			}

			// Handle TRPC routes
			if (req.url?.startsWith('/api/trpc/')) {
				try {
					// Parse URL and add query object that TRPC expects
					const url = new URL(req.url, `http://${req.headers.host}`);
					const pathParts = url.pathname.split('/api/trpc/');
					const trpcPath = pathParts[1] || '';

					// Build query object
					(req as any).query = {};
					url.searchParams.forEach((value, key) => {
						(req as any).query[key] = value;
					});
					(req as any).query.trpc = trpcPath;

					return await trpcHandler(req as any, res as any);
				} catch (error) {
					console.error('TRPC error:', error);
					res.writeHead(500);
					res.end();
					return;
				}
			}

			// All other routes (pages, static files, etc.) go to Next.js
			handle(req, res);
		});

		// WEBSOCKET
		setupDrawerLogsWebSocketServer(server);
		setupDeploymentLogsWebSocketServer(server);
		setupDockerContainerLogsWebSocketServer(server);
		setupDockerContainerTerminalWebSocketServer(server);
		setupTerminalWebSocketServer(server);
		if (!IS_CLOUD) {
			setupDockerStatsMonitoringSocketServer(server);
		}

		if (process.env.NODE_ENV === "production" && !IS_CLOUD) {
			setupDirectories();
			createDefaultMiddlewares();
			await initializeNetwork();
			createDefaultTraefikConfig();
			createDefaultServerTraefikConfig();
			await migration();
			await initCronJobs();
			await initSchedules();
			await initCancelDeployments();
			await initVolumeBackupsCronJobs();
			await sendHanzoRestartNotifications();
		}

		if (IS_CLOUD && process.env.NODE_ENV === "production") {
			await migration();
			
			// Initialize billing jobs
			console.log("🚀 Starting billing jobs...");
			const { startUsageCollectionSchedule } = await import("@hanzo/platform/billing/usage-tracker");
			const { startBillingSchedule } = await import("@hanzo/platform/billing/billing-job");
			startUsageCollectionSchedule();
			startBillingSchedule();
			console.log("✅ Billing jobs started");
		}

		server.listen(PORT, HOST);
		console.log(`Server Started on: http://${HOST}:${PORT}`);
		if (!IS_CLOUD) {
			console.log("Starting Deployment Worker");
			const { deploymentWorker } = await import("./queues/deployments-queue");
			await deploymentWorker.run();
		}
	} catch (e) {
		console.error("Main Server Error", e);
	}
});
