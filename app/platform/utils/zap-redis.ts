/**
 * utils/zap-redis.ts — native ZAP RPC client (browser) for the Redis
 * capability. Replaces the tRPC `api.redis.*` surface.
 *
 * Opens a single WebSocket to `/zap/redis` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated RedisMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { RedisMethod } from "@/server/zap/schema/redis_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/redis");

// Every Redis method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(RedisMethod.one, "one", args);
const search = rpc.query(RedisMethod.search, "search", args);
const readLogs = rpc.query(RedisMethod.readLogs, "readLogs", args);

export const redis = {
	create: rpc.mutation(RedisMethod.create, args),
	one,
	start: rpc.mutation(RedisMethod.start, args),
	reload: rpc.mutation(RedisMethod.reload, args),
	stop: rpc.mutation(RedisMethod.stop, args),
	saveExternalPort: rpc.mutation(RedisMethod.saveExternalPort, args),
	deploy: rpc.mutation(RedisMethod.deploy, args),
	deployWithLogs: rpc.mutation(RedisMethod.deployWithLogs, args),
	changeStatus: rpc.mutation(RedisMethod.changeStatus, args),
	remove: rpc.mutation(RedisMethod.remove, args),
	saveEnvironment: rpc.mutation(RedisMethod.saveEnvironment, args),
	update: rpc.mutation(RedisMethod.update, args),
	changePassword: rpc.mutation(RedisMethod.changePassword, args),
	move: rpc.mutation(RedisMethod.move, args),
	rebuild: rpc.mutation(RedisMethod.rebuild, args),
	search,
	readLogs,
	useUtils: makeUseUtils({ one, search, readLogs }),
} as const;
