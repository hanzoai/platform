/**
 * utils/zap-dns.ts — native ZAP RPC client (browser) for the DNS capability.
 * Replaces the tRPC `api.dns.*` surface.
 *
 * Opens a single WebSocket to `/zap/dns` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated DnsMethod ordinal. Inputs ride the shared Args carrier (encodeArgs);
 * results the shared Result carrier. useUtils() exposes per-query invalidation,
 * mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { DnsMethod } from "@/server/zap/schema/dns_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/dns");

// Every DNS method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const listZones = rpc.query(DnsMethod.listZones, "listZones", args);
const listRecords = rpc.query(DnsMethod.listRecords, "listRecords", args);
const listPagesProjects = rpc.query(
	DnsMethod.listPagesProjects,
	"listPagesProjects",
	args,
);
const getPagesProject = rpc.query(
	DnsMethod.getPagesProject,
	"getPagesProject",
	args,
);

export const dns = {
	listZones,
	createZone: rpc.mutation(DnsMethod.createZone, args),
	deleteZone: rpc.mutation(DnsMethod.deleteZone, args),
	listRecords,
	createRecord: rpc.mutation(DnsMethod.createRecord, args),
	updateRecord: rpc.mutation(DnsMethod.updateRecord, args),
	deleteRecord: rpc.mutation(DnsMethod.deleteRecord, args),
	verifyDomain: rpc.mutation(DnsMethod.verifyDomain, args),
	listPagesProjects,
	getPagesProject,
	createPagesProject: rpc.mutation(DnsMethod.createPagesProject, args),
	triggerPagesDeploy: rpc.mutation(DnsMethod.triggerPagesDeploy, args),
	addPagesDomain: rpc.mutation(DnsMethod.addPagesDomain, args),
	removePagesDomain: rpc.mutation(DnsMethod.removePagesDomain, args),
	useUtils: makeUseUtils({
		listZones,
		listRecords,
		listPagesProjects,
		getPagesProject,
	}),
} as const;
