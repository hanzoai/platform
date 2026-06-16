/**
 * utils/zap.ts — native ZAP RPC client (browser) for the DOKS capability.
 *
 * Replaces the former tRPC `api.doks.*` surface. Opens a single WebSocket to
 * `/zap/doks` via @zap-proto/web's `connect()` (shared transport in
 * utils/zap-client.ts), speaks native binary ZAP envelopes (no JSON, no tRPC),
 * and dispatches by the generated DoksMethod ordinal.
 *
 * Ergonomics mirror the tRPC surface the UI already uses:
 *   const { data } = doks.getByOrg.useQuery();
 *   const provision = doks.provision.useMutation();
 *   provision.mutate({ organizationId, region, ha: false });
 *
 * Struct builders (newXxx) and ordinals (DoksMethod) are generated from
 * server/zap/schema/doks.zap; this file only wires them to react-query hooks.
 */

import { makeRpc } from "@/utils/zap-client";
import {
	DoksMethod,
	newAddNodePoolParams,
	newClusterRef,
	newDeleteNodePoolParams,
	newEmpty,
	newProvisionParams,
	newUpdateNodePoolParams,
} from "@/server/zap/schema/doks_zap";

const rpc = makeRpc("/zap/doks");

// The Empty struct carries a single padding byte (a ZAP struct needs >=1 field);
// parameterless methods send it with _pad=0.
const empty = () => newEmpty({ _pad: 0 });

// Builders that fill the generated struct from a loose UI args object, applying
// the same optional defaults ("" / 0 = unset) the schema documents.
const provision = (a: Record<string, unknown>) =>
	newProvisionParams({
		organizationId: String(a.organizationId ?? ""),
		region: String(a.region ?? ""),
		nodeSize: String(a.nodeSize ?? ""),
		ha: Boolean(a.ha),
		nodeCount: typeof a.nodeCount === "number" ? a.nodeCount : 0,
	});
const ref = (a: Record<string, unknown>) =>
	newClusterRef({ doksClusterId: String(a.doksClusterId ?? "") });
const addPool = (a: Record<string, unknown>) =>
	newAddNodePoolParams({
		doksClusterId: String(a.doksClusterId ?? ""),
		name: String(a.name ?? ""),
		size: String(a.size ?? ""),
		count: typeof a.count === "number" ? a.count : 0,
	});
const updatePool = (a: Record<string, unknown>) =>
	newUpdateNodePoolParams({
		doksClusterId: String(a.doksClusterId ?? ""),
		poolId: String(a.poolId ?? ""),
		size: String(a.size ?? ""),
		count: typeof a.count === "number" ? a.count : 0,
	});
const deletePool = (a: Record<string, unknown>) =>
	newDeleteNodePoolParams({
		doksClusterId: String(a.doksClusterId ?? ""),
		poolId: String(a.poolId ?? ""),
	});

/**
 * The DOKS RPC surface — drop-in shaped for the prior tRPC `api.doks.*` usage.
 * Result types are untyped (the shared Result carrier returns heterogeneous DB
 * rows / provider payloads); callsites narrow as they did against tRPC.
 */
export const doks = {
	provision: rpc.mutation(DoksMethod.provision, provision),
	get: rpc.query(DoksMethod.get, "get", ref),
	getByOrg: rpc.query(DoksMethod.getByOrg, "getByOrg", empty),
	status: rpc.query(DoksMethod.status, "status", ref),
	kubeconfig: rpc.query(DoksMethod.kubeconfig, "kubeconfig", ref),
	delete: rpc.mutation(DoksMethod.delete, ref),
	upgradeToHA: rpc.mutation(DoksMethod.upgradeToHA, ref),
	addNodePool: rpc.mutation(DoksMethod.addNodePool, addPool),
	updateNodePool: rpc.mutation(DoksMethod.updateNodePool, updatePool),
	deleteNodePool: rpc.mutation(DoksMethod.deleteNodePool, deletePool),
	list: rpc.query(DoksMethod.list, "list", empty),
	sync: rpc.mutation(DoksMethod.sync, empty),
	listNodeSizes: rpc.query(DoksMethod.listNodeSizes, "listNodeSizes", empty),
	listRegions: rpc.query(DoksMethod.listRegions, "listRegions", empty),
	clusterCost: rpc.query(DoksMethod.clusterCost, "clusterCost", ref),
	orgBilling: rpc.query(DoksMethod.orgBilling, "orgBilling", empty),
	fleetBilling: rpc.query(DoksMethod.fleetBilling, "fleetBilling", empty),
	recordSnapshot: rpc.mutation(DoksMethod.recordSnapshot, empty),
} as const;
