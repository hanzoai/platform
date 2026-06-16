/**
 * utils/zap-mongo.ts — native ZAP RPC client (browser) for the Mongo
 * capability. Replaces the tRPC `api.mongo.*` surface.
 *
 * Opens a single WebSocket to `/zap/mongo` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated MongoMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { MongoMethod } from "@/server/zap/schema/mongo_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/mongo");

// Every Mongo method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(MongoMethod.one, "one", args);
const search = rpc.query(MongoMethod.search, "search", args);
const readLogs = rpc.query(MongoMethod.readLogs, "readLogs", args);

export const mongo = {
	create: rpc.mutation(MongoMethod.create, args),
	one,
	start: rpc.mutation(MongoMethod.start, args),
	stop: rpc.mutation(MongoMethod.stop, args),
	saveExternalPort: rpc.mutation(MongoMethod.saveExternalPort, args),
	deploy: rpc.mutation(MongoMethod.deploy, args),
	deployWithLogs: rpc.mutation(MongoMethod.deployWithLogs, args),
	changeStatus: rpc.mutation(MongoMethod.changeStatus, args),
	reload: rpc.mutation(MongoMethod.reload, args),
	remove: rpc.mutation(MongoMethod.remove, args),
	saveEnvironment: rpc.mutation(MongoMethod.saveEnvironment, args),
	update: rpc.mutation(MongoMethod.update, args),
	changePassword: rpc.mutation(MongoMethod.changePassword, args),
	move: rpc.mutation(MongoMethod.move, args),
	rebuild: rpc.mutation(MongoMethod.rebuild, args),
	search,
	readLogs,
	useUtils: makeUseUtils({ one, search, readLogs }),
} as const;
