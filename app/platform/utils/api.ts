/**
 * This is the client-side entrypoint for your tRPC API. It is used to create the `api` object which
 * contains the Next.js App-wrapper, as well as your type-safe React Query hooks.
 *
 * We also create a few inference helpers for input and output types.
 */

import {
	createWSClient,
	httpBatchLink,
	splitLink,
	wsLink,
} from "@trpc/client";
import { createTRPCNext } from "@trpc/next";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import superjson from "superjson";
import type { AppRouter } from "@/server/api/root";

const getBaseUrl = () => {
	if (typeof window !== "undefined") return ""; // browser should use relative url
	return `http://localhost:${process.env.PORT ?? 3000}`; // dev SSR should use localhost
};

const getWsUrl = () => {
	if (typeof window === "undefined") return "";

	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const host = window.location.host;

	return `${protocol}${host}/drawer-logs`;
};

/**
 * Create WebSocket client using tRPC v11's built-in lazy mode.
 * In v11, createWSClient supports lazy: { enabled: true } which
 * defers the connection until the first subscription is made.
 */
const getWsClient = () => {
	if (typeof window === "undefined") return null;

	return createWSClient({
		url: getWsUrl(),
		lazy: {
			enabled: true,
			closeMs: 0,
		},
	});
};

const wsClient = getWsClient();

/** A set of type-safe react-query hooks for your tRPC API. */
export const api = createTRPCNext<AppRouter>({
	/**
	 * In tRPC v11, the transformer moves from inside config() to the
	 * top-level createTRPCNext options.
	 *
	 * @see https://trpc.io/docs/v11/data-transformers
	 *
	 * Note: tRPC v11 uses a conditional type to check the transformer flag:
	 *   `undefined extends TOptions["transformer"] ? false : true`
	 * With strictNullChecks disabled, undefined is assignable to all types,
	 * so this always resolves to false. The @ts-expect-error suppresses the
	 * resulting type error. The runtime behavior is correct.
	 */
	// @ts-expect-error -- strictNullChecks:false breaks tRPC v11 transformer type inference
	transformer: superjson,

	config() {
		return {
			/**
			 * Links used to determine request flow from client to server.
			 *
			 * @see https://trpc.io/docs/links
			 */
			links: [
				splitLink({
					condition: (op) => op.type === "subscription",
					true: wsLink({
						client: wsClient!,
						// @ts-expect-error -- strictNullChecks:false breaks tRPC v11 transformer type inference
						transformer: superjson,
					}),
					false: httpBatchLink({
						url: `${getBaseUrl()}/api/trpc`,
						// @ts-expect-error -- strictNullChecks:false breaks tRPC v11 transformer type inference
						transformer: superjson,
					}),
				}),
			],
		};
	},
	/**
	 * Whether tRPC should await queries when server rendering pages.
	 *
	 * @see https://trpc.io/docs/nextjs#ssr-boolean-default-false
	 */
	ssr: false,
});

/**
 * Inference helper for inputs.
 *
 * @example type HelloInput = RouterInputs['example']['hello']
 */
export type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * Inference helper for outputs.
 *
 * @example type HelloOutput = RouterOutputs['example']['hello']
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;
