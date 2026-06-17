/**
 * utils/zap-application.ts — native ZAP RPC client (browser) for the Application
 * capability. Replaces the tRPC `api.application.*` surface.
 *
 * Opens a single WebSocket to `/zap/application` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated ApplicationMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { ApplicationMethod } from "@/server/zap/schema/application_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/application");

// Every Application method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(ApplicationMethod.one, "one", args);
const readTraefikConfig = rpc.query(
	ApplicationMethod.readTraefikConfig,
	"readTraefikConfig",
	args,
);
const readAppMonitoring = rpc.query(
	ApplicationMethod.readAppMonitoring,
	"readAppMonitoring",
	args,
);
const search = rpc.query(ApplicationMethod.search, "search", args);
const readLogs = rpc.query(ApplicationMethod.readLogs, "readLogs", args);

export const application = {
	create: rpc.mutation(ApplicationMethod.create, args),
	one,
	reload: rpc.mutation(ApplicationMethod.reload, args),
	delete: rpc.mutation(ApplicationMethod.delete, args),
	stop: rpc.mutation(ApplicationMethod.stop, args),
	start: rpc.mutation(ApplicationMethod.start, args),
	redeploy: rpc.mutation(ApplicationMethod.redeploy, args),
	saveEnvironment: rpc.mutation(ApplicationMethod.saveEnvironment, args),
	saveBuildType: rpc.mutation(ApplicationMethod.saveBuildType, args),
	saveGithubProvider: rpc.mutation(ApplicationMethod.saveGithubProvider, args),
	saveGitlabProvider: rpc.mutation(ApplicationMethod.saveGitlabProvider, args),
	saveBitbucketProvider: rpc.mutation(
		ApplicationMethod.saveBitbucketProvider,
		args,
	),
	saveGiteaProvider: rpc.mutation(ApplicationMethod.saveGiteaProvider, args),
	saveDockerProvider: rpc.mutation(ApplicationMethod.saveDockerProvider, args),
	saveGitProvider: rpc.mutation(ApplicationMethod.saveGitProvider, args),
	disconnectGitProvider: rpc.mutation(
		ApplicationMethod.disconnectGitProvider,
		args,
	),
	markRunning: rpc.mutation(ApplicationMethod.markRunning, args),
	update: rpc.mutation(ApplicationMethod.update, args),
	refreshToken: rpc.mutation(ApplicationMethod.refreshToken, args),
	deploy: rpc.mutation(ApplicationMethod.deploy, args),
	cleanQueues: rpc.mutation(ApplicationMethod.cleanQueues, args),
	clearDeployments: rpc.mutation(ApplicationMethod.clearDeployments, args),
	killBuild: rpc.mutation(ApplicationMethod.killBuild, args),
	readTraefikConfig,
	dropDeployment: rpc.mutation(ApplicationMethod.dropDeployment, args),
	updateTraefikConfig: rpc.mutation(
		ApplicationMethod.updateTraefikConfig,
		args,
	),
	readAppMonitoring,
	move: rpc.mutation(ApplicationMethod.move, args),
	cancelDeployment: rpc.mutation(ApplicationMethod.cancelDeployment, args),
	search,
	readLogs,
	useUtils: makeUseUtils({
		one,
		readTraefikConfig,
		readAppMonitoring,
		search,
		readLogs,
	}),
} as const;
