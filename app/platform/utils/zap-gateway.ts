/**
 * utils/zap-gateway.ts — native ZAP RPC client (browser) for the Gateway
 * capability. Replaces the tRPC `api.gateway.*` surface.
 *
 * Opens a single WebSocket to `/zap/gateway` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated GatewayMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { GatewayMethod } from "@/server/zap/schema/gateway_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/gateway");

// Every Gateway method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const status = rpc.query(GatewayMethod.status, "status", args);
const listRateLimits = rpc.query(
	GatewayMethod.listRateLimits,
	"listRateLimits",
	args,
);
const listRoutes = rpc.query(GatewayMethod.listRoutes, "listRoutes", args);

export const gateway = {
	status,
	listRateLimits,
	createRateLimit: rpc.mutation(GatewayMethod.createRateLimit, args),
	updateRateLimit: rpc.mutation(GatewayMethod.updateRateLimit, args),
	deleteRateLimit: rpc.mutation(GatewayMethod.deleteRateLimit, args),
	listRoutes,
	createRoute: rpc.mutation(GatewayMethod.createRoute, args),
	updateRoute: rpc.mutation(GatewayMethod.updateRoute, args),
	deleteRoute: rpc.mutation(GatewayMethod.deleteRoute, args),
	useUtils: makeUseUtils({ status, listRateLimits, listRoutes }),
} as const;
