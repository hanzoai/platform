/**
 * Native ZAP RPC client (browser) — DOKS capability.
 *
 * Replaces the former JSON-RPC HTTP shim (which fetched `/call` against the
 * AI-agent bridge). This is the browser frontend's binary-ZAP transport: it
 * opens a single WebSocket to `/zap/doks` via `@zap-proto/web`'s `connect()`,
 * speaks native ZAP envelopes over WS binary frames (no JSON, no tRPC), and
 * dispatches by method ordinal.
 *
 * Ergonomics mirror the tRPC `api.doks.*` surface the UI already uses:
 *   const { data } = doks.getByOrg.useQuery();
 *   const provision = doks.provision.useMutation();
 *   provision.mutate({ organizationId, region, ha: false });
 *
 * Auth: the session cookie rides the WS upgrade automatically (same-origin),
 * which `serve()`'s mintCap validates; a rejected upgrade surfaces as a
 * WebRpcError. Method ordinals are the single source of truth in
 * server/zap/schema/doks.zap (mirrored by DoksMethod).
 */

import {
	type UseMutationOptions,
	type UseQueryOptions,
	useMutation,
	useQuery,
} from "@tanstack/react-query";
import { type Connection, connect } from "@zap-proto/web/client";
import { type Conn, Status } from "@zap-proto/zap";
import {
	AddNodePoolParams,
	ClusterRef,
	DeleteNodePoolParams,
	decodeResult,
	Empty,
	encodeStruct,
	ProvisionParams,
	type StructSpec,
	UpdateNodePoolParams,
} from "@/server/zap/codec";

/**
 * The default output type for a DOKS RPC method. The generic `Result` carrier
 * returns the service value untyped (heterogeneous DB rows / provider payloads
 * with no stable column contract at this layer), so callsites narrow exactly as
 * they did against tRPC's inferred outputs. When per-method result StructSpecs
 * land (future work), each method's TOut is set to its concrete result type.
 */
// biome-ignore lint/suspicious/noExplicitAny: the generic Result carrier is untyped by design
type ZapValue = any;

// Method ordinals — mirror server/zap/schema/doks.zap (and DoksMethod server-side).
const Method = {
	provision: 0,
	get: 1,
	getByOrg: 2,
	status: 3,
	kubeconfig: 4,
	delete: 5,
	upgradeToHA: 6,
	addNodePool: 7,
	updateNodePool: 8,
	deleteNodePool: 9,
	list: 10,
	sync: 11,
	listNodeSizes: 12,
	listRegions: 13,
	clusterCost: 14,
	orgBilling: 15,
	fleetBilling: 16,
	recordSnapshot: 17,
} as const;

function wsUrl(): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}/zap/doks`;
}

// One lazy connection per tab, shared by every call (Conn is FIFO-correlated).
let connPromise: Promise<Connection<Conn>> | null = null;

function getConn(): Promise<Connection<Conn>> {
	if (!connPromise) {
		connPromise = connect<Conn>(wsUrl()).catch((err) => {
			connPromise = null; // allow reconnect on next call
			throw err;
		});
	}
	return connPromise;
}

/** Invoke one DOKS method: encode params, call by ordinal, decode the result. */
async function invoke<T>(
	method: number,
	spec: StructSpec,
	params: Record<string, unknown>,
): Promise<T> {
	const { bootstrap } = await getConn();
	const payload = encodeStruct(spec, params);
	const resp = await bootstrap.call(method, { payload });
	const value = decodeResult(resp.body);
	if (resp.status !== Status.OK) {
		const message =
			value && typeof value === "object" && "error" in value
				? String((value as { error: unknown }).error)
				: `zap/doks call failed (status ${resp.status})`;
		throw new Error(message);
	}
	return value as T;
}

/** A query method (hook + raw call), keyed for react-query caching. */
function query<TArgs extends Record<string, unknown>, TOut = ZapValue>(
	method: number,
	spec: StructSpec,
	key: string,
) {
	return {
		call: (args: TArgs) => invoke<TOut>(method, spec, args),
		useQuery: (
			args?: TArgs,
			options?: Omit<UseQueryOptions<TOut, Error>, "queryKey" | "queryFn">,
		) =>
			useQuery<TOut, Error>({
				queryKey: ["zap", "doks", key, args ?? null],
				queryFn: () => invoke<TOut>(method, spec, args ?? {}),
				...options,
			}),
	};
}

/** A mutation method (hook + raw call). */
function mutation<
	TArgs extends Record<string, unknown> = Record<string, unknown>,
	TOut = ZapValue,
>(method: number, spec: StructSpec) {
	return {
		call: (args: TArgs) => invoke<TOut>(method, spec, args),
		useMutation: (
			options?: Omit<UseMutationOptions<TOut, Error, TArgs>, "mutationFn">,
		) =>
			useMutation<TOut, Error, TArgs>({
				mutationFn: (args) => invoke<TOut>(method, spec, args),
				...options,
			}),
	};
}

/**
 * The DOKS RPC surface — drop-in shaped for the prior tRPC `api.doks.*` usage.
 * Result types are `unknown`-by-default (the generic Result carrier); callsites
 * narrow as they did against tRPC's inferred outputs.
 */
export const doks = {
	provision: mutation(Method.provision, ProvisionParams),
	get: query(Method.get, ClusterRef, "get"),
	getByOrg: query(Method.getByOrg, Empty, "getByOrg"),
	status: query(Method.status, ClusterRef, "status"),
	kubeconfig: query(Method.kubeconfig, ClusterRef, "kubeconfig"),
	delete: mutation(Method.delete, ClusterRef),
	upgradeToHA: mutation(Method.upgradeToHA, ClusterRef),
	addNodePool: mutation(Method.addNodePool, AddNodePoolParams),
	updateNodePool: mutation(Method.updateNodePool, UpdateNodePoolParams),
	deleteNodePool: mutation(Method.deleteNodePool, DeleteNodePoolParams),
	list: query(Method.list, Empty, "list"),
	sync: mutation(Method.sync, Empty),
	listNodeSizes: query(Method.listNodeSizes, Empty, "listNodeSizes"),
	listRegions: query(Method.listRegions, Empty, "listRegions"),
	clusterCost: query(Method.clusterCost, ClusterRef, "clusterCost"),
	orgBilling: query(Method.orgBilling, Empty, "orgBilling"),
	fleetBilling: query(Method.fleetBilling, Empty, "fleetBilling"),
	recordSnapshot: mutation(Method.recordSnapshot, Empty),
} as const;
