/**
 * utils/zap-ai.ts — native ZAP RPC client (browser) for the AI capability.
 * Replaces the tRPC `api.ai.*` surface.
 *
 * Opens a single WebSocket to `/zap/ai` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated AiMethod ordinal. Inputs ride the shared Args carrier (encodeArgs);
 * results the shared Result carrier. useUtils() exposes per-query invalidation,
 * mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { AiMethod } from "@/server/zap/schema/ai_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/ai");

// Every AI method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(AiMethod.one, "one", args);
const getModels = rpc.query(AiMethod.getModels, "getModels", args);
const getAll = rpc.query(AiMethod.getAll, "getAll", args);
const get = rpc.query(AiMethod.get, "get", args);
const getEnabledProviders = rpc.query(
	AiMethod.getEnabledProviders,
	"getEnabledProviders",
	args,
);

export const ai = {
	one,
	getModels,
	create: rpc.mutation(AiMethod.create, args),
	update: rpc.mutation(AiMethod.update, args),
	getAll,
	get,
	delete: rpc.mutation(AiMethod.delete, args),
	getEnabledProviders,
	analyzeLogs: rpc.mutation(AiMethod.analyzeLogs, args),
	testConnection: rpc.mutation(AiMethod.testConnection, args),
	suggest: rpc.mutation(AiMethod.suggest, args),
	deploy: rpc.mutation(AiMethod.deploy, args),
	useUtils: makeUseUtils({ one, getModels, getAll, get, getEnabledProviders }),
} as const;
