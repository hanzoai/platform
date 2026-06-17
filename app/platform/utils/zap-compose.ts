/**
 * utils/zap-compose.ts — native ZAP RPC client (browser) for the Compose
 * capability. Replaces the tRPC `api.compose.*` surface.
 *
 * Opens a single WebSocket to `/zap/compose` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated ComposeMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { ComposeMethod } from "@/server/zap/schema/compose_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/compose");

// Every Compose method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(ComposeMethod.one, "one", args);
const loadServices = rpc.query(ComposeMethod.loadServices, "loadServices", args);
const loadMountsByService = rpc.query(
	ComposeMethod.loadMountsByService,
	"loadMountsByService",
	args,
);
const getConvertedCompose = rpc.query(
	ComposeMethod.getConvertedCompose,
	"getConvertedCompose",
	args,
);
const getDefaultCommand = rpc.query(
	ComposeMethod.getDefaultCommand,
	"getDefaultCommand",
	args,
);
const templates = rpc.query(ComposeMethod.templates, "templates", args);
const getTags = rpc.query(ComposeMethod.getTags, "getTags", args);
const search = rpc.query(ComposeMethod.search, "search", args);
const readLogs = rpc.query(ComposeMethod.readLogs, "readLogs", args);

export const compose = {
	create: rpc.mutation(ComposeMethod.create, args),
	one,
	update: rpc.mutation(ComposeMethod.update, args),
	saveEnvironment: rpc.mutation(ComposeMethod.saveEnvironment, args),
	delete: rpc.mutation(ComposeMethod.delete, args),
	cleanQueues: rpc.mutation(ComposeMethod.cleanQueues, args),
	clearDeployments: rpc.mutation(ComposeMethod.clearDeployments, args),
	killBuild: rpc.mutation(ComposeMethod.killBuild, args),
	loadServices,
	loadMountsByService,
	fetchSourceType: rpc.mutation(ComposeMethod.fetchSourceType, args),
	randomizeCompose: rpc.mutation(ComposeMethod.randomizeCompose, args),
	isolatedDeployment: rpc.mutation(ComposeMethod.isolatedDeployment, args),
	getConvertedCompose,
	deploy: rpc.mutation(ComposeMethod.deploy, args),
	redeploy: rpc.mutation(ComposeMethod.redeploy, args),
	stop: rpc.mutation(ComposeMethod.stop, args),
	start: rpc.mutation(ComposeMethod.start, args),
	getDefaultCommand,
	refreshToken: rpc.mutation(ComposeMethod.refreshToken, args),
	deployTemplate: rpc.mutation(ComposeMethod.deployTemplate, args),
	templates,
	getTags,
	disconnectGitProvider: rpc.mutation(
		ComposeMethod.disconnectGitProvider,
		args,
	),
	move: rpc.mutation(ComposeMethod.move, args),
	processTemplate: rpc.mutation(ComposeMethod.processTemplate, args),
	previewTemplate: rpc.mutation(ComposeMethod.previewTemplate, args),
	import: rpc.mutation(ComposeMethod.import, args),
	cancelDeployment: rpc.mutation(ComposeMethod.cancelDeployment, args),
	search,
	readLogs,
	useUtils: makeUseUtils({
		one,
		loadServices,
		loadMountsByService,
		getConvertedCompose,
		getDefaultCommand,
		templates,
		getTags,
		search,
		readLogs,
	}),
} as const;
