/**
 * utils/zap-mysql.ts — native ZAP RPC client (browser) for the Mysql
 * capability. Replaces the tRPC `api.mysql.*` surface.
 *
 * Opens a single WebSocket to `/zap/mysql` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated MysqlMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 *
 * `deployWithLogs` was a tRPC `.subscription()` streaming deploy log lines; on
 * the ZAP side it is a mutation that resolves to the collected array of log
 * lines (see mysql-cap.ts).
 */

import { encodeArgs } from "@/server/zap/args";
import { MysqlMethod } from "@/server/zap/schema/mysql_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/mysql");

// Every Mysql method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(MysqlMethod.one, "one", args);
const search = rpc.query(MysqlMethod.search, "search", args);
const readLogs = rpc.query(MysqlMethod.readLogs, "readLogs", args);

export const mysql = {
	create: rpc.mutation(MysqlMethod.create, args),
	one,
	start: rpc.mutation(MysqlMethod.start, args),
	stop: rpc.mutation(MysqlMethod.stop, args),
	saveExternalPort: rpc.mutation(MysqlMethod.saveExternalPort, args),
	deploy: rpc.mutation(MysqlMethod.deploy, args),
	deployWithLogs: rpc.mutation(MysqlMethod.deployWithLogs, args),
	changeStatus: rpc.mutation(MysqlMethod.changeStatus, args),
	reload: rpc.mutation(MysqlMethod.reload, args),
	remove: rpc.mutation(MysqlMethod.remove, args),
	saveEnvironment: rpc.mutation(MysqlMethod.saveEnvironment, args),
	update: rpc.mutation(MysqlMethod.update, args),
	changePassword: rpc.mutation(MysqlMethod.changePassword, args),
	move: rpc.mutation(MysqlMethod.move, args),
	rebuild: rpc.mutation(MysqlMethod.rebuild, args),
	search,
	readLogs,
	useUtils: makeUseUtils({ one, search, readLogs }),
} as const;
