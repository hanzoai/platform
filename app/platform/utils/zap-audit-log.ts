/**
 * utils/zap-audit-log.ts — native ZAP RPC client (browser) for the AuditLog
 * capability. Replaces the tRPC `api.auditLog.*` surface.
 *
 * Opens a single WebSocket to `/zap/audit-log` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated AuditLogMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes per-query
 * invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { AuditLogMethod } from "@/server/zap/schema/audit-log_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/audit-log");

// Every AuditLog method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const all = rpc.query(AuditLogMethod.all, "all", args);

export const auditLog = {
	all,
	useUtils: makeUseUtils({ all }),
} as const;
