/**
 * utils/zap-postgres.ts — native ZAP RPC client (browser) for the Postgres
 * capability. Replaces the tRPC `api.postgres.*` surface.
 *
 * Opens a single WebSocket to `/zap/postgres` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated PostgresMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { PostgresMethod } from "@/server/zap/schema/postgres_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/postgres");

// Every Postgres method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(PostgresMethod.one, "one", args);
const search = rpc.query(PostgresMethod.search, "search", args);
const readLogs = rpc.query(PostgresMethod.readLogs, "readLogs", args);

export const postgres = {
	create: rpc.mutation(PostgresMethod.create, args),
	one,
	start: rpc.mutation(PostgresMethod.start, args),
	stop: rpc.mutation(PostgresMethod.stop, args),
	saveExternalPort: rpc.mutation(PostgresMethod.saveExternalPort, args),
	deploy: rpc.mutation(PostgresMethod.deploy, args),
	deployWithLogs: rpc.mutation(PostgresMethod.deployWithLogs, args),
	changeStatus: rpc.mutation(PostgresMethod.changeStatus, args),
	remove: rpc.mutation(PostgresMethod.remove, args),
	saveEnvironment: rpc.mutation(PostgresMethod.saveEnvironment, args),
	reload: rpc.mutation(PostgresMethod.reload, args),
	update: rpc.mutation(PostgresMethod.update, args),
	changePassword: rpc.mutation(PostgresMethod.changePassword, args),
	move: rpc.mutation(PostgresMethod.move, args),
	rebuild: rpc.mutation(PostgresMethod.rebuild, args),
	search,
	readLogs,
	useUtils: makeUseUtils({ one, search, readLogs }),
} as const;
