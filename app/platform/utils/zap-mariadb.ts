/**
 * utils/zap-mariadb.ts — native ZAP RPC client (browser) for the Mariadb
 * capability. Replaces the tRPC `api.mariadb.*` surface.
 *
 * Opens a single WebSocket to `/zap/mariadb` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated MariadbMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { MariadbMethod } from "@/server/zap/schema/mariadb_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/mariadb");

// Every Mariadb method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(MariadbMethod.one, "one", args);
const search = rpc.query(MariadbMethod.search, "search", args);
const readLogs = rpc.query(MariadbMethod.readLogs, "readLogs", args);

export const mariadb = {
	create: rpc.mutation(MariadbMethod.create, args),
	one,
	start: rpc.mutation(MariadbMethod.start, args),
	stop: rpc.mutation(MariadbMethod.stop, args),
	saveExternalPort: rpc.mutation(MariadbMethod.saveExternalPort, args),
	deploy: rpc.mutation(MariadbMethod.deploy, args),
	deployWithLogs: rpc.mutation(MariadbMethod.deployWithLogs, args),
	changeStatus: rpc.mutation(MariadbMethod.changeStatus, args),
	remove: rpc.mutation(MariadbMethod.remove, args),
	saveEnvironment: rpc.mutation(MariadbMethod.saveEnvironment, args),
	reload: rpc.mutation(MariadbMethod.reload, args),
	update: rpc.mutation(MariadbMethod.update, args),
	changePassword: rpc.mutation(MariadbMethod.changePassword, args),
	move: rpc.mutation(MariadbMethod.move, args),
	rebuild: rpc.mutation(MariadbMethod.rebuild, args),
	search,
	readLogs,
	useUtils: makeUseUtils({ one, search, readLogs }),
} as const;
