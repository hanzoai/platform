/**
 * utils/zap-schedule.ts — native ZAP RPC client (browser) for the Schedule
 * capability. Replaces the tRPC `api.schedule.*` surface.
 *
 * Opens a single WebSocket to `/zap/schedule` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated ScheduleMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { ScheduleMethod } from "@/server/zap/schema/schedule_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/schedule");

// Every Schedule method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const list = rpc.query(ScheduleMethod.list, "list", args);
const one = rpc.query(ScheduleMethod.one, "one", args);

export const schedule = {
	create: rpc.mutation(ScheduleMethod.create, args),
	update: rpc.mutation(ScheduleMethod.update, args),
	delete: rpc.mutation(ScheduleMethod.delete, args),
	list,
	one,
	runManually: rpc.mutation(ScheduleMethod.runManually, args),
	useUtils: makeUseUtils({ list, one }),
} as const;
