/**
 * utils/zap-docker.ts — native ZAP RPC client (browser) for the Docker
 * capability. Replaces the tRPC `api.docker.*` surface.
 *
 * Opens a single WebSocket to `/zap/docker` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated DockerMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { DockerMethod } from "@/server/zap/schema/docker_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/docker");

// Every Docker method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const getContainers = rpc.query(
	DockerMethod.getContainers,
	"getContainers",
	args,
);
const getConfig = rpc.query(DockerMethod.getConfig, "getConfig", args);
const getContainersByAppNameMatch = rpc.query(
	DockerMethod.getContainersByAppNameMatch,
	"getContainersByAppNameMatch",
	args,
);
const getContainersByAppLabel = rpc.query(
	DockerMethod.getContainersByAppLabel,
	"getContainersByAppLabel",
	args,
);
const getStackContainersByAppName = rpc.query(
	DockerMethod.getStackContainersByAppName,
	"getStackContainersByAppName",
	args,
);
const getServiceContainersByAppName = rpc.query(
	DockerMethod.getServiceContainersByAppName,
	"getServiceContainersByAppName",
	args,
);

export const docker = {
	getContainers,
	restartContainer: rpc.mutation(DockerMethod.restartContainer, args),
	startContainer: rpc.mutation(DockerMethod.startContainer, args),
	stopContainer: rpc.mutation(DockerMethod.stopContainer, args),
	killContainer: rpc.mutation(DockerMethod.killContainer, args),
	removeContainer: rpc.mutation(DockerMethod.removeContainer, args),
	getConfig,
	getContainersByAppNameMatch,
	getContainersByAppLabel,
	getStackContainersByAppName,
	getServiceContainersByAppName,
	uploadFileToContainer: rpc.mutation(
		DockerMethod.uploadFileToContainer,
		args,
	),
	useUtils: makeUseUtils({
		getContainers,
		getConfig,
		getContainersByAppNameMatch,
		getContainersByAppLabel,
		getStackContainersByAppName,
		getServiceContainersByAppName,
	}),
} as const;
