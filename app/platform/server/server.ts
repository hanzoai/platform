import http from "node:http";
import {
	createDefaultMiddlewares,
	createDefaultServerTraefikConfig,
	createDefaultTraefikConfig,
	IS_CLOUD,
	initCancelDeployments,
	initCronJobs,
	initEnterpriseBackupCronJobs,
	initializeNetwork,
	initSchedules,
	initVolumeBackupsCronJobs,
	sendHanzoPlatformRestartNotifications,
	setupDirectories,
} from "@hanzo/platform";
import { createPlatformZapServer } from "@hanzo/platform/services/zap-bridge";
import { serve } from "@zap-proto/web/server";
import { config } from "dotenv";
import next from "next";
import packageInfo from "../package.json";
import { migration } from "./db/migration";
import { setupDockerContainerLogsWebSocketServer } from "./wss/docker-container-logs";
import { setupDockerContainerTerminalWebSocketServer } from "./wss/docker-container-terminal";
import { setupDockerStatsMonitoringSocketServer } from "./wss/docker-stats";
import { setupDrawerLogsWebSocketServer } from "./wss/drawer-logs";
import { setupDeploymentLogsWebSocketServer } from "./wss/listen-deployment";
import { setupTerminalWebSocketServer } from "./wss/terminal";
import { aiMintCap, aiRootCap } from "./zap/ai-cap";
import { billingMintCap, billingRootCap } from "./zap/billing-cap";
import { clusterMintCap, clusterRootCap } from "./zap/cluster-cap";
import {
	destinationMintCap,
	destinationRootCap,
} from "./zap/destination-cap";
import {
	digitaloceanMintCap,
	digitaloceanRootCap,
} from "./zap/digitalocean-cap";
import { dnsMintCap, dnsRootCap } from "./zap/dns-cap";
import { doksMintCap, doksRootCap } from "./zap/doks-cap";
import { domainMintCap, domainRootCap } from "./zap/domain-cap";
import {
	environmentMintCap,
	environmentRootCap,
} from "./zap/environment-cap";
import { gatewayMintCap, gatewayRootCap } from "./zap/gateway-cap";
import { k8sMintCap, k8sRootCap } from "./zap/k8s-cap";
import { mountMintCap, mountRootCap } from "./zap/mount-cap";
import {
	notificationMintCap,
	notificationRootCap,
} from "./zap/notification-cap";
import {
	organizationMintCap,
	organizationRootCap,
} from "./zap/organization-cap";
import { portMintCap, portRootCap } from "./zap/port-cap";
import { projectMintCap, projectRootCap } from "./zap/project-cap";
import {
	redirectsMintCap,
	redirectsRootCap,
} from "./zap/redirects-cap";
import { registryMintCap, registryRootCap } from "./zap/registry-cap";

config({ path: ".env" });
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const dev = process.env.NODE_ENV !== "production";

// Initialize critical directories and Traefik config BEFORE Next.js starts
// This prevents race conditions with the install script
if (process.env.NODE_ENV === "production" && !IS_CLOUD) {
	setupDirectories();
	createDefaultTraefikConfig();
	createDefaultServerTraefikConfig();
	console.log("✅ initialization complete");
}

const app = next({ dev, turbopack: process.env.TURBOPACK === "1" });
const handle = app.getRequestHandler();
void app.prepare().then(async () => {
	try {
		console.log("Running Hanzo Platform Version: ", packageInfo.version);
		const server = http.createServer((req, res) => {
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

		// Native ZAP RPC (browser frontend) — replaces the tRPC doksRouter.
		// Binary ZAP envelopes over the WS upgrade at /zap/doks; auth is
		// minted at the upgrade boundary (doksMintCap → HTTP 401 on null).
		serve(server, {
			path: "/zap/doks",
			mintCap: doksMintCap,
			rootCap: doksRootCap,
			onError: (err) => console.error("[zap/doks]", err),
		});
		// Gateway capability (admin) — replaces the tRPC gatewayRouter.
		serve(server, {
			path: "/zap/gateway",
			mintCap: gatewayMintCap,
			rootCap: gatewayRootCap,
			onError: (err) => console.error("[zap/gateway]", err),
		});
		// Cluster capability (Docker Swarm) — replaces the tRPC clusterRouter.
		serve(server, {
			path: "/zap/cluster",
			mintCap: clusterMintCap,
			rootCap: clusterRootCap,
			onError: (err) => console.error("[zap/cluster]", err),
		});
		// K8s deploy capability — replaces the tRPC k8sRouter.
		serve(server, {
			path: "/zap/k8s",
			mintCap: k8sMintCap,
			rootCap: k8sRootCap,
			onError: (err) => console.error("[zap/k8s]", err),
		});
		// DNS capability — replaces the tRPC dnsRouter.
		serve(server, {
			path: "/zap/dns",
			mintCap: dnsMintCap,
			rootCap: dnsRootCap,
			onError: (err) => console.error("[zap/dns]", err),
		});
		// AI capability — replaces the tRPC aiRouter. Admin methods gated
		// per-call inside aiRootCap.
		serve(server, {
			path: "/zap/ai",
			mintCap: aiMintCap,
			rootCap: aiRootCap,
			onError: (err) => console.error("[zap/ai]", err),
		});
		// Project capability — replaces the tRPC projectRouter.
		serve(server, {
			path: "/zap/project",
			mintCap: projectMintCap,
			rootCap: projectRootCap,
			onError: (err) => console.error("[zap/project]", err),
		});
		// Environment capability — replaces the tRPC environmentRouter.
		serve(server, {
			path: "/zap/environment",
			mintCap: environmentMintCap,
			rootCap: environmentRootCap,
			onError: (err) => console.error("[zap/environment]", err),
		});
		// Organization capability — replaces the tRPC organizationRouter.
		serve(server, {
			path: "/zap/organization",
			mintCap: organizationMintCap,
			rootCap: organizationRootCap,
			onError: (err) => console.error("[zap/organization]", err),
		});
		// Notification capability — replaces the tRPC notificationRouter.
		serve(server, {
			path: "/zap/notification",
			mintCap: notificationMintCap,
			rootCap: notificationRootCap,
			onError: (err) => console.error("[zap/notification]", err),
		});
		// Destination capability — replaces the tRPC destinationRouter.
		serve(server, {
			path: "/zap/destination",
			mintCap: destinationMintCap,
			rootCap: destinationRootCap,
			onError: (err) => console.error("[zap/destination]", err),
		});
		// Registry capability — replaces the tRPC registryRouter.
		serve(server, {
			path: "/zap/registry",
			mintCap: registryMintCap,
			rootCap: registryRootCap,
			onError: (err) => console.error("[zap/registry]", err),
		});
		// DigitalOcean capability — replaces the tRPC digitaloceanRouter.
		serve(server, {
			path: "/zap/digitalocean",
			mintCap: digitaloceanMintCap,
			rootCap: digitaloceanRootCap,
			onError: (err) => console.error("[zap/digitalocean]", err),
		});
		// Billing capability — replaces the tRPC billingRouter.
		serve(server, {
			path: "/zap/billing",
			mintCap: billingMintCap,
			rootCap: billingRootCap,
			onError: (err) => console.error("[zap/billing]", err),
		});
		// Domain capability — replaces the tRPC domainRouter.
		serve(server, {
			path: "/zap/domain",
			mintCap: domainMintCap,
			rootCap: domainRootCap,
			onError: (err) => console.error("[zap/domain]", err),
		});
		// Mount capability — replaces the tRPC mountRouter.
		serve(server, {
			path: "/zap/mount",
			mintCap: mountMintCap,
			rootCap: mountRootCap,
			onError: (err) => console.error("[zap/mount]", err),
		});
		// Port capability — replaces the tRPC portRouter.
		serve(server, {
			path: "/zap/port",
			mintCap: portMintCap,
			rootCap: portRootCap,
			onError: (err) => console.error("[zap/port]", err),
		});
		// Redirects capability — replaces the tRPC redirectsRouter.
		serve(server, {
			path: "/zap/redirects",
			mintCap: redirectsMintCap,
			rootCap: redirectsRootCap,
			onError: (err) => console.error("[zap/redirects]", err),
		});

		server.listen(PORT, HOST);
		console.log(`Server Started on: http://${HOST}:${PORT}`);
		if (process.env.NODE_ENV === "production" && !IS_CLOUD) {
			createDefaultMiddlewares();
			await initializeNetwork();
			await initCronJobs();
			await initSchedules();
			await initCancelDeployments();
			await initVolumeBackupsCronJobs();
			await sendHanzoPlatformRestartNotifications();
		}

		if (IS_CLOUD && process.env.NODE_ENV === "production") {
			await migration();

			// Initialize billing jobs
			console.log("Starting billing jobs...");
			const { startUsageCollectionSchedule } = await import(
				"@hanzo/platform/billing/usage-tracker"
			);
			const { startBillingSchedule } = await import(
				"@hanzo/platform/billing/billing-job"
			);
			const { startBillingCycleScheduler } = await import(
				"@hanzo/platform/billing/billing-cycle"
			);
			startUsageCollectionSchedule();
			startBillingSchedule();
			startBillingCycleScheduler();
			console.log("Billing jobs started");
		}

		// Start ZAP bridge for AI agent/MCP access
		if (process.env.ZAP_ENABLED !== "false") {
			createPlatformZapServer();
		}
		await initEnterpriseBackupCronJobs();

		if (!IS_CLOUD) {
			console.log("Starting Deployment Worker");
			const { deploymentWorker } = await import("./queues/deployments-queue");
			await deploymentWorker.run();
		}
	} catch (e) {
		console.error("Main Server Error", e);
	}
});
