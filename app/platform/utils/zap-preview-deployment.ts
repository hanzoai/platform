/**
 * utils/zap-preview-deployment.ts — native ZAP RPC client (browser) for the
 * PreviewDeployment capability. Replaces the tRPC `api.previewDeployment.*`
 * surface.
 *
 * Opens a single WebSocket to `/zap/preview-deployment` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated PreviewDeploymentMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes per-query
 * invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { PreviewDeploymentMethod } from "@/server/zap/schema/preview-deployment_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/preview-deployment");

// Every PreviewDeployment method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const all = rpc.query(PreviewDeploymentMethod.all, "all", args);
const one = rpc.query(PreviewDeploymentMethod.one, "one", args);

export const previewDeployment = {
	all,
	one,
	delete: rpc.mutation(PreviewDeploymentMethod.delete, args),
	redeploy: rpc.mutation(PreviewDeploymentMethod.redeploy, args),
	useUtils: makeUseUtils({ all, one }),
} as const;
