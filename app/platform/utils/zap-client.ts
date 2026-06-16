/**
 * zap-client.ts — the shared browser ZAP RPC transport, reused by every
 * migrated router's typed client (utils/zap-<router>.ts).
 *
 * Each router opens ONE lazy WebSocket to `/zap/<router>` via @zap-proto/web's
 * `connect()`, speaks native binary ZAP envelopes over WS frames (no JSON, no
 * tRPC), and dispatches by the generated method ordinal. The session cookie
 * rides the upgrade automatically (same-origin), which serve()'s mintCap
 * validates; a rejected upgrade surfaces as a thrown error.
 *
 * This module is the ONE definition of: the WS url, the per-path lazy Conn
 * cache, and the encode→call→decode invoke. Per-router clients supply only the
 * path, the generated `newXxx` builders, the `XxxMethod` ordinals, and the
 * react-query hook shapes (see makeRpc).
 */

import {
	type UseMutationOptions,
	type UseQueryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { type Connection, connect } from "@zap-proto/web/client";
import { type Conn, Status } from "@zap-proto/zap";
import { decodeResult } from "@/server/zap/result";

function wsUrl(path: string): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}${path}`;
}

// One lazy connection per endpoint path, shared by every call on that router
// (Conn is FIFO-correlated). Keyed by path so each router's socket is distinct.
const conns = new Map<string, Promise<Connection<Conn>>>();

function getConn(path: string): Promise<Connection<Conn>> {
	let p = conns.get(path);
	if (!p) {
		p = connect<Conn>(wsUrl(path)).catch((err) => {
			conns.delete(path); // allow reconnect on next call
			throw err;
		});
		conns.set(path, p);
	}
	return p;
}

/** Invoke one method on a router endpoint: encode params, call, decode Result. */
export async function invoke<T>(
	path: string,
	method: number,
	payload: Uint8Array,
): Promise<T> {
	const { bootstrap } = await getConn(path);
	const resp = await bootstrap.call(method, { payload });
	const value = decodeResult(resp.body);
	if (resp.status !== Status.OK) {
		const message =
			value && typeof value === "object" && "error" in value
				? String((value as { error: unknown }).error)
				: `zap call failed (status ${resp.status})`;
		throw new Error(message);
	}
	return value as T;
}

// biome-ignore lint/suspicious/noExplicitAny: the generic Result carrier is untyped by design
export type ZapValue = any;

/** A builder maps a params object to the ZAP-encoded payload for one method. */
export type Encode<TArgs> = (args: TArgs) => Uint8Array;

/** A query method's react-query key prefix — used by useUtils invalidation. */
const queryKeyOf = (path: string, key: string, args?: unknown) =>
	args === undefined
		? (["zap", path, key] as const)
		: (["zap", path, key, args] as const);

/** A query method handle: hook + raw call + its key (for invalidation). */
export interface ZapQuery<TArgs, TOut> {
	call(args: TArgs): Promise<TOut>;
	useQuery(
		args?: TArgs,
		options?: Omit<UseQueryOptions<TOut, Error>, "queryKey" | "queryFn">,
	): ReturnType<typeof useQuery<TOut, Error>>;
	/** The react-query key for this method (optionally narrowed by args). */
	queryKey(args?: TArgs): readonly unknown[];
	readonly _key: string;
}

/** A mutation method handle: hook + raw call. */
export interface ZapMutation<TArgs, TOut> {
	call(args: TArgs): Promise<TOut>;
	useMutation(
		options?: Omit<UseMutationOptions<TOut, Error, TArgs>, "mutationFn">,
	): ReturnType<typeof useMutation<TOut, Error, TArgs>>;
}

/**
 * makeRpc builds the per-router hook factory bound to one endpoint path. A
 * router client calls `const rpc = makeRpc("/zap/<router>")` then declares each
 * method as `rpc.query(ordinal, key, newXxx)` / `rpc.mutation(ordinal, newXxx)`.
 */
export function makeRpc(path: string) {
	return {
		query<TArgs extends Record<string, unknown>, TOut = ZapValue>(
			method: number,
			key: string,
			encode: Encode<TArgs>,
		): ZapQuery<TArgs, TOut> {
			return {
				call: (args: TArgs) => invoke<TOut>(path, method, encode(args)),
				queryKey: (args?: TArgs) =>
					queryKeyOf(path, key, args ?? null),
				_key: key,
				useQuery: (args?, options?) =>
					useQuery<TOut, Error>({
						queryKey: queryKeyOf(path, key, args ?? null),
						queryFn: () =>
							invoke<TOut>(path, method, encode((args ?? {}) as TArgs)),
						...options,
					}),
			};
		},
		mutation<
			TArgs extends Record<string, unknown> = Record<string, unknown>,
			TOut = ZapValue,
		>(method: number, encode: Encode<TArgs>): ZapMutation<TArgs, TOut> {
			return {
				call: (args: TArgs) => invoke<TOut>(path, method, encode(args)),
				useMutation: (options?) =>
					useMutation<TOut, Error, TArgs>({
						mutationFn: (args) => invoke<TOut>(path, method, encode(args)),
						...options,
					}),
			};
		},
	};
}

/**
 * makeUseUtils builds a router-scoped `useUtils()` hook from the router's query
 * handles, exposing `utils.<method>.invalidate(args?)` keyed by the same
 * react-query key the query hook uses — the ZAP equivalent of tRPC's
 * `api.useUtils()`. Mutations have no cache entry, so only queries appear here.
 */
export function makeUseUtils<Q extends Record<string, ZapQuery<any, any>>>(
	queries: Q,
) {
	return function useUtils() {
		const qc = useQueryClient();
		const out = {} as {
			[K in keyof Q]: {
				invalidate(args?: Parameters<Q[K]["queryKey"]>[0]): Promise<void>;
				refetch(args?: Parameters<Q[K]["queryKey"]>[0]): Promise<void>;
			};
		};
		for (const name of Object.keys(queries) as (keyof Q)[]) {
			const q = queries[name];
			out[name] = {
				invalidate: (args?) =>
					qc.invalidateQueries({
						queryKey: args === undefined ? q.queryKey() : q.queryKey(args),
					}),
				refetch: (args?) =>
					qc.refetchQueries({
						queryKey: args === undefined ? q.queryKey() : q.queryKey(args),
					}),
			};
		}
		return out;
	};
}
