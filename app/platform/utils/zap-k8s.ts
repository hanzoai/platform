/**
 * utils/zap-k8s.ts — native ZAP RPC client (browser) for the K8s capability.
 * Replaces the tRPC `api.k8s.*` surface.
 *
 * Opens a single WebSocket to `/zap/k8s` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated K8sMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { K8sMethod } from "@/server/zap/schema/k8s_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/k8s");

// Every K8s method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const status = rpc.query(K8sMethod.status, "status", args);
const logs = rpc.query(K8sMethod.logs, "logs", args);

export const k8s = {
	deploy: rpc.mutation(K8sMethod.deploy, args),
	teardown: rpc.mutation(K8sMethod.teardown, args),
	status,
	logs,
	deployStack: rpc.mutation(K8sMethod.deployStack, args),
	useUtils: makeUseUtils({ status, logs }),
} as const;
