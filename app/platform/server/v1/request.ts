/**
 * Fetch ⇄ Node request adapter for the App Router /v1 surface.
 *
 * The platform's identity + tRPC layer was written against Node's
 * `IncomingMessage` shape: `validateRequest` (pkg/platform/src/lib/auth.ts)
 * reads `req.headers["x-api-key"]`, `getBearerToken` reads
 * `req.headers.authorization` / `req.headers.cookie`, and several tRPC
 * procedures read `ctx.req.headers[...]` (visor, settings, sso). App Router
 * hands us a WHATWG `Request` instead, so this is the ONE place that bridges
 * the two — a plain object with lowercased header keys that satisfies every
 * `{ headers: Record<string, string | string[] | undefined> }` consumer.
 *
 * This is a boundary adapter, not a shim around business logic: the identity
 * verification in validateRequest stays byte-for-byte identical; only the
 * transport shape is translated here, once.
 */
import type { IncomingMessage } from "node:http";

/** The minimal Node-request shape every /v1 consumer actually reads. */
export interface NodeLikeRequest {
	headers: Record<string, string | string[] | undefined>;
	method?: string;
	url?: string;
}

/**
 * Convert a WHATWG `Request` into the Node-`IncomingMessage`-shaped object that
 * `validateRequest` / `getBearerToken` / tRPC `ctx.req` consumers expect. Header
 * keys are lowercased (Node convention); values are plain strings (fetch
 * `Headers` already folds duplicates per the spec).
 */
export function toNodeLikeRequest(req: Request): NodeLikeRequest {
	const headers: Record<string, string> = {};
	req.headers.forEach((value, key) => {
		headers[key.toLowerCase()] = value;
	});
	return { headers, method: req.method, url: req.url };
}

/**
 * `validateRequest` is typed for `IncomingMessage` but only ever touches
 * `.headers`. Cast the adapter output at this single boundary so callers do not
 * each repeat the cast.
 */
export function asIncomingMessage(req: Request): IncomingMessage {
	return toNodeLikeRequest(req) as unknown as IncomingMessage;
}
