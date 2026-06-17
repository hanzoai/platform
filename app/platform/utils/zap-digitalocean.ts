/**
 * utils/zap-digitalocean.ts — native ZAP RPC client (browser) for the
 * DigitalOcean capability. Replaces the tRPC `api.digitalocean.*` surface.
 *
 * Opens a single WebSocket to `/zap/digitalocean` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated DigitalOceanMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 *
 * The tRPC `onNodeStatusChange` subscription is dropped (no client consumer,
 * no ZAP transport equivalent); the UI polls listPoolInstances directly.
 */

import { encodeArgs } from "@/server/zap/args";
import { DigitalOceanMethod } from "@/server/zap/schema/digitalocean_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/digitalocean");

// Every DigitalOcean method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const listProviders = rpc.query(
	DigitalOceanMethod.listProviders,
	"listProviders",
	args,
);
const getProvider = rpc.query(
	DigitalOceanMethod.getProvider,
	"getProvider",
	args,
);
const listSizes = rpc.query(DigitalOceanMethod.listSizes, "listSizes", args);
const listRegions = rpc.query(
	DigitalOceanMethod.listRegions,
	"listRegions",
	args,
);
const listPoolInstances = rpc.query(
	DigitalOceanMethod.listPoolInstances,
	"listPoolInstances",
	args,
);
const getScalingStatus = rpc.query(
	DigitalOceanMethod.getScalingStatus,
	"getScalingStatus",
	args,
);
const listScalingJobs = rpc.query(
	DigitalOceanMethod.listScalingJobs,
	"listScalingJobs",
	args,
);
const getSwarmJoinToken = rpc.query(
	DigitalOceanMethod.getSwarmJoinToken,
	"getSwarmJoinToken",
	args,
);

export const digitalocean = {
	configureProvider: rpc.mutation(
		DigitalOceanMethod.configureProvider,
		args,
	),
	updateProvider: rpc.mutation(DigitalOceanMethod.updateProvider, args),
	listProviders,
	getProvider,
	deleteProvider: rpc.mutation(DigitalOceanMethod.deleteProvider, args),
	listSizes,
	listRegions,
	scaleUp: rpc.mutation(DigitalOceanMethod.scaleUp, args),
	scaleDown: rpc.mutation(DigitalOceanMethod.scaleDown, args),
	resizeInstance: rpc.mutation(DigitalOceanMethod.resizeInstance, args),
	drainNode: rpc.mutation(DigitalOceanMethod.drainNode, args),
	removeInstance: rpc.mutation(DigitalOceanMethod.removeInstance, args),
	listPoolInstances,
	getScalingStatus,
	listScalingJobs,
	createFirewall: rpc.mutation(DigitalOceanMethod.createFirewall, args),
	createLoadBalancer: rpc.mutation(
		DigitalOceanMethod.createLoadBalancer,
		args,
	),
	registerNode: rpc.mutation(DigitalOceanMethod.registerNode, args),
	getSwarmJoinToken,
	useUtils: makeUseUtils({
		listProviders,
		getProvider,
		listSizes,
		listRegions,
		listPoolInstances,
		getScalingStatus,
		listScalingJobs,
		getSwarmJoinToken,
	}),
} as const;
