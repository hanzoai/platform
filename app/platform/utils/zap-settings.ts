/**
 * utils/zap-settings.ts — native ZAP RPC client (browser) for the Settings
 * capability. Replaces the tRPC `api.settings.*` surface.
 *
 * Opens a single WebSocket to `/zap/settings` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated SettingsMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. `.query` procedures map to
 * `rpc.query`, everything else (`.mutation`) to `rpc.mutation`. useUtils()
 * exposes per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { SettingsMethod } from "@/server/zap/schema/settings_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/settings");

// Every Settings method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const getWebServerSettings = rpc.query(
	SettingsMethod.getWebServerSettings,
	"getWebServerSettings",
	args,
);
const getDockerDiskUsage = rpc.query(
	SettingsMethod.getDockerDiskUsage,
	"getDockerDiskUsage",
	args,
);
const readTraefikConfig = rpc.query(
	SettingsMethod.readTraefikConfig,
	"readTraefikConfig",
	args,
);
const readWebServerTraefikConfig = rpc.query(
	SettingsMethod.readWebServerTraefikConfig,
	"readWebServerTraefikConfig",
	args,
);
const readMiddlewareTraefikConfig = rpc.query(
	SettingsMethod.readMiddlewareTraefikConfig,
	"readMiddlewareTraefikConfig",
	args,
);
const getHanzoVersion = rpc.query(
	SettingsMethod.getHanzoVersion,
	"getHanzoVersion",
	args,
);
const getReleaseTag = rpc.query(
	SettingsMethod.getReleaseTag,
	"getReleaseTag",
	args,
);
const readDirectories = rpc.query(
	SettingsMethod.readDirectories,
	"readDirectories",
	args,
);
const readTraefikFile = rpc.query(
	SettingsMethod.readTraefikFile,
	"readTraefikFile",
	args,
);
const getIp = rpc.query(SettingsMethod.getIp, "getIp", args);
const getOpenApiDocument = rpc.query(
	SettingsMethod.getOpenApiDocument,
	"getOpenApiDocument",
	args,
);
const readTraefikEnv = rpc.query(
	SettingsMethod.readTraefikEnv,
	"readTraefikEnv",
	args,
);
const haveTraefikDashboardPortEnabled = rpc.query(
	SettingsMethod.haveTraefikDashboardPortEnabled,
	"haveTraefikDashboardPortEnabled",
	args,
);
const readStatsLogs = rpc.query(
	SettingsMethod.readStatsLogs,
	"readStatsLogs",
	args,
);
const readStats = rpc.query(SettingsMethod.readStats, "readStats", args);
const haveActivateRequests = rpc.query(
	SettingsMethod.haveActivateRequests,
	"haveActivateRequests",
	args,
);
const isCloud = rpc.query(SettingsMethod.isCloud, "isCloud", args);
const isUserSubscribed = rpc.query(
	SettingsMethod.isUserSubscribed,
	"isUserSubscribed",
	args,
);
const health = rpc.query(SettingsMethod.health, "health", args);
const checkInfrastructureHealth = rpc.query(
	SettingsMethod.checkInfrastructureHealth,
	"checkInfrastructureHealth",
	args,
);
const checkGPUStatus = rpc.query(
	SettingsMethod.checkGPUStatus,
	"checkGPUStatus",
	args,
);
const getTraefikPorts = rpc.query(
	SettingsMethod.getTraefikPorts,
	"getTraefikPorts",
	args,
);
const getLogCleanupStatus = rpc.query(
	SettingsMethod.getLogCleanupStatus,
	"getLogCleanupStatus",
	args,
);
const getHanzoCloudIps = rpc.query(
	SettingsMethod.getHanzoCloudIps,
	"getHanzoCloudIps",
	args,
);

export const settings = {
	getWebServerSettings,
	reloadServer: rpc.mutation(SettingsMethod.reloadServer, args),
	cleanRedis: rpc.mutation(SettingsMethod.cleanRedis, args),
	reloadRedis: rpc.mutation(SettingsMethod.reloadRedis, args),
	cleanAllDeploymentQueue: rpc.mutation(
		SettingsMethod.cleanAllDeploymentQueue,
		args,
	),
	reloadTraefik: rpc.mutation(SettingsMethod.reloadTraefik, args),
	toggleDashboard: rpc.mutation(SettingsMethod.toggleDashboard, args),
	cleanUnusedImages: rpc.mutation(SettingsMethod.cleanUnusedImages, args),
	cleanUnusedVolumes: rpc.mutation(SettingsMethod.cleanUnusedVolumes, args),
	cleanStoppedContainers: rpc.mutation(
		SettingsMethod.cleanStoppedContainers,
		args,
	),
	cleanDockerBuilder: rpc.mutation(SettingsMethod.cleanDockerBuilder, args),
	cleanDockerPrune: rpc.mutation(SettingsMethod.cleanDockerPrune, args),
	cleanAll: rpc.mutation(SettingsMethod.cleanAll, args),
	cleanMonitoring: rpc.mutation(SettingsMethod.cleanMonitoring, args),
	getDockerDiskUsage,
	saveSSHPrivateKey: rpc.mutation(SettingsMethod.saveSSHPrivateKey, args),
	assignDomainServer: rpc.mutation(SettingsMethod.assignDomainServer, args),
	cleanSSHPrivateKey: rpc.mutation(SettingsMethod.cleanSSHPrivateKey, args),
	updateDockerCleanup: rpc.mutation(SettingsMethod.updateDockerCleanup, args),
	updateRemoteServersOnly: rpc.mutation(
		SettingsMethod.updateRemoteServersOnly,
		args,
	),
	updateEnforceSSO: rpc.mutation(SettingsMethod.updateEnforceSSO, args),
	readTraefikConfig,
	updateTraefikConfig: rpc.mutation(SettingsMethod.updateTraefikConfig, args),
	readWebServerTraefikConfig,
	updateWebServerTraefikConfig: rpc.mutation(
		SettingsMethod.updateWebServerTraefikConfig,
		args,
	),
	readMiddlewareTraefikConfig,
	updateMiddlewareTraefikConfig: rpc.mutation(
		SettingsMethod.updateMiddlewareTraefikConfig,
		args,
	),
	getUpdateData: rpc.mutation(SettingsMethod.getUpdateData, args),
	updateServer: rpc.mutation(SettingsMethod.updateServer, args),
	getHanzoVersion,
	getReleaseTag,
	readDirectories,
	updateTraefikFile: rpc.mutation(SettingsMethod.updateTraefikFile, args),
	readTraefikFile,
	getIp,
	updateServerIp: rpc.mutation(SettingsMethod.updateServerIp, args),
	getOpenApiDocument,
	readTraefikEnv,
	writeTraefikEnv: rpc.mutation(SettingsMethod.writeTraefikEnv, args),
	haveTraefikDashboardPortEnabled,
	readStatsLogs,
	readStats,
	haveActivateRequests,
	toggleRequests: rpc.mutation(SettingsMethod.toggleRequests, args),
	isCloud,
	isUserSubscribed,
	health,
	checkInfrastructureHealth,
	setupGPU: rpc.mutation(SettingsMethod.setupGPU, args),
	checkGPUStatus,
	updateTraefikPorts: rpc.mutation(SettingsMethod.updateTraefikPorts, args),
	getTraefikPorts,
	updateLogCleanup: rpc.mutation(SettingsMethod.updateLogCleanup, args),
	getLogCleanupStatus,
	getHanzoCloudIps,
	useUtils: makeUseUtils({
		getWebServerSettings,
		getDockerDiskUsage,
		readTraefikConfig,
		readWebServerTraefikConfig,
		readMiddlewareTraefikConfig,
		getHanzoVersion,
		getReleaseTag,
		readDirectories,
		readTraefikFile,
		getIp,
		getOpenApiDocument,
		readTraefikEnv,
		haveTraefikDashboardPortEnabled,
		readStatsLogs,
		readStats,
		haveActivateRequests,
		isCloud,
		isUserSubscribed,
		health,
		checkInfrastructureHealth,
		checkGPUStatus,
		getTraefikPorts,
		getLogCleanupStatus,
		getHanzoCloudIps,
	}),
} as const;
