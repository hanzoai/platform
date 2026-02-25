/**
 * ZAP Agent Bridge Client
 *
 * Calls the platform's JSON-RPC agent bridge (zap-bridge.ts) over HTTP.
 * This is the AI agent / MCP interface, NOT the native ZAP binary protocol.
 *
 * The native ZAP protocol uses Cap'n Proto binary serialization over persistent
 * TCP connections (port 9998, two-party VatNetwork RPC). For the native protocol,
 * see @hanzo/zap-client and the schema at pkg/zap/schema/platform.capnp.
 *
 * This bridge exists so that browser frontends and AI agents can call platform
 * operations via standard HTTP/JSON without a Cap'n Proto client.
 *
 * Usage:
 *   import { zap } from "@/utils/zap";
 *
 *   // Query (calls HTTP bridge, NOT native Cap'n Proto)
 *   const { data } = zap.useQuery("platform.list_projects", { organizationId: "..." });
 *
 *   // Mutation
 *   const mutation = zap.useMutation("platform.create_project");
 *   mutation.mutate({ name: "My Project", organizationId: "..." });
 */

import { useMutation, useQuery, type UseQueryOptions, type UseMutationOptions } from "@tanstack/react-query";

// NOTE: This connects to the JSON-RPC HTTP bridge, not the native Cap'n Proto
// TCP endpoint. The bridge translates HTTP/JSON calls into Cap'n Proto RPC
// internally. Port 9998 is the native ZAP port; the bridge runs on BRIDGE_PORT.
const ZAP_BRIDGE_PORT = process.env.NEXT_PUBLIC_ZAP_BRIDGE_PORT || "9999";

const ZAP_BRIDGE_URL = typeof window !== "undefined"
	? `${window.location.protocol}//${window.location.host}`
	: `http://localhost:${ZAP_BRIDGE_PORT}`;

async function zapCall<T = any>(name: string, args: Record<string, any> = {}): Promise<T> {
	const res = await fetch(`${ZAP_BRIDGE_URL}/call`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(process.env.NEXT_PUBLIC_ZAP_TOKEN
				? { Authorization: `Bearer ${process.env.NEXT_PUBLIC_ZAP_TOKEN}` }
				: {}),
		},
		body: JSON.stringify({ name, arguments: args }),
	});

	const result = await res.json();
	if (result.isError) {
		throw new Error(result.error || "ZAP call failed");
	}
	return result.data as T;
}

async function zapListTools() {
	const res = await fetch(`${ZAP_BRIDGE_URL}/tools`, {
		headers: process.env.NEXT_PUBLIC_ZAP_TOKEN
			? { Authorization: `Bearer ${process.env.NEXT_PUBLIC_ZAP_TOKEN}` }
			: {},
	});
	return res.json();
}

/**
 * React hook for ZAP queries (GET-like operations).
 */
function useZapQuery<T = any>(
	toolName: string,
	args?: Record<string, any>,
	options?: Omit<UseQueryOptions<T, Error>, "queryKey" | "queryFn">,
) {
	return useQuery<T, Error>({
		queryKey: ["zap", toolName, args],
		queryFn: () => zapCall<T>(toolName, args),
		...options,
	});
}

/**
 * React hook for ZAP mutations (POST-like operations).
 */
function useZapMutation<T = any, TArgs = Record<string, any>>(
	toolName: string,
	options?: Omit<UseMutationOptions<T, Error, TArgs>, "mutationFn">,
) {
	return useMutation<T, Error, TArgs>({
		mutationFn: (args) => zapCall<T>(toolName, args as Record<string, any>),
		...options,
	});
}

export const zap = {
	call: zapCall,
	listTools: zapListTools,
	useQuery: useZapQuery,
	useMutation: useZapMutation,
};
