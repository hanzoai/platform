/**
 * Generic helpers for the platform /v1 REST surface (App Router).
 *
 * These are transport-level primitives shared by every /v1 route handler —
 * service-token auth, method gating, param/query/header reads. They are
 * deliberately domain-free: the PaaS container API (server/paas/container-api.ts)
 * and the apps-lifecycle API (server/apps/apps-api.ts) both consume them so there
 * is exactly one implementation of "is this caller authorized" and "is this
 * method allowed" across /v1.
 *
 * Fetch-native: /v1 is served by App Router route handlers, so these operate on
 * the WHATWG `Request` and return / build `Response` objects. No pages-router
 * `NextApiRequest`/`res` anywhere.
 *
 * Auth model: a shared service bearer token. /v1 is a machine-to-machine +
 * read-mostly surface; the platform backend cannot validate IAM user tokens, so
 * callers (the console/UI server, external automation) send
 * `Authorization: Bearer ${PLATFORM_SERVICE_TOKEN}`.
 */
import { timingSafeEqual } from "node:crypto";

/** Constant-time string compare; false on length mismatch (no early exit). */
export function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

/**
 * Result of a service-token check. On failure the caller returns `response`
 * verbatim; on success it proceeds. A discriminated union keeps the "write the
 * error and stop" contract explicit without a res object to mutate.
 */
export type ServiceTokenResult =
	| { ok: true }
	| { ok: false; response: Response };

/**
 * Validate the shared service token against one of the accepted env vars.
 *
 * `envVars` lets a surface accept a service-specific token while keeping the
 * generic platform token as a fallback (first non-empty configured value wins
 * as the expected secret). The PaaS surface, for instance, passes
 * `["PAAS_SERVICE_TOKEN", "PLATFORM_SERVICE_TOKEN"]`.
 */
export function requireServiceToken(
	req: Request,
	envVars: readonly string[] = ["PLATFORM_SERVICE_TOKEN"],
): ServiceTokenResult {
	const expected = envVars
		.map((name) => process.env[name])
		.find((v): v is string => !!v);
	if (!expected) {
		return {
			ok: false,
			response: Response.json(
				{
					message: `Service token is not configured on the server (set one of: ${envVars.join(", ")})`,
				},
				{ status: 500 },
			),
		};
	}
	const header = req.headers.get("authorization") ?? "";
	const prefix = "Bearer ";
	const provided = header.startsWith(prefix) ? header.slice(prefix.length) : "";
	if (!provided || !safeEqual(provided, expected)) {
		return {
			ok: false,
			response: Response.json({ message: "Unauthorized" }, { status: 401 }),
		};
	}
	return { ok: true };
}

/** 405 with an `Allow` header listing the permitted methods. */
export function methodNotAllowed(allowed: string[]): Response {
	return Response.json(
		{ message: "Method not allowed" },
		{ status: 405, headers: { Allow: allowed.join(", ") } },
	);
}

/** Read a single query-string value, or undefined. */
export function queryValue(req: Request, name: string): string | undefined {
	return new URL(req.url).searchParams.get(name) ?? undefined;
}

/** Read a header value, or undefined. */
export function headerValue(req: Request, name: string): string | undefined {
	return req.headers.get(name) ?? undefined;
}
