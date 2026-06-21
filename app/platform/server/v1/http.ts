/**
 * Generic helpers for the platform /v1 REST surface.
 *
 * These are transport-level primitives shared by every /v1 handler — service
 * token auth, method gating, dynamic-param narrowing. They are deliberately
 * domain-free: the PaaS container API (server/paas/container-api.ts) and the
 * apps-lifecycle API (server/apps/apps-api.ts) both consume them so there is
 * exactly one implementation of "is this caller authorized" and "is this method
 * allowed" across /v1.
 *
 * Auth model: a shared service bearer token. /v1 is a machine-to-machine +
 * read-mostly surface; the platform backend cannot validate IAM user tokens, so
 * callers (the console/UI server, external automation) send
 * `Authorization: Bearer ${PLATFORM_SERVICE_TOKEN}`. Mirrors the pattern in
 * pages/api/v1/build-callback.ts.
 */
import { timingSafeEqual } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";

/** Constant-time string compare; false on length mismatch (no early exit). */
export function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

/**
 * Validate the shared service token against one of the accepted env vars. On
 * failure, writes the error response and returns false; returns true when the
 * caller is authenticated.
 *
 * `envVars` lets a surface accept a service-specific token while keeping the
 * generic platform token as a fallback (first non-empty configured value wins
 * as the expected secret). The PaaS surface, for instance, passes
 * `["PAAS_SERVICE_TOKEN", "PLATFORM_SERVICE_TOKEN"]`.
 */
export function requireServiceToken(
	req: NextApiRequest,
	res: NextApiResponse,
	envVars: readonly string[] = ["PLATFORM_SERVICE_TOKEN"],
): boolean {
	const expected = envVars
		.map((name) => process.env[name])
		.find((v): v is string => !!v);
	if (!expected) {
		res.status(500).json({
			message: `Service token is not configured on the server (set one of: ${envVars.join(", ")})`,
		});
		return false;
	}
	const header = req.headers.authorization ?? "";
	const prefix = "Bearer ";
	const provided = header.startsWith(prefix) ? header.slice(prefix.length) : "";
	if (!provided || !safeEqual(provided, expected)) {
		res.status(401).json({ message: "Unauthorized" });
		return false;
	}
	return true;
}

/** 405 with an `Allow` header listing the permitted methods. */
export function methodNotAllowed(
	req: NextApiRequest,
	res: NextApiResponse,
	allowed: string[],
): void {
	res.setHeader("Allow", allowed);
	res.status(405).json({ message: `Method ${req.method} not allowed` });
}

/**
 * Boundary validator for dynamic route params. Each named param in `req.query`
 * may be string | string[] | undefined; this narrows them to plain strings and
 * 400s on any missing one. Returns the typed record, or null after writing the
 * error response (caller should `return`).
 */
export function requireParams<K extends string>(
	req: NextApiRequest,
	res: NextApiResponse,
	names: readonly K[],
): Record<K, string> | null {
	const out = {} as Record<K, string>;
	for (const name of names) {
		const raw = req.query[name];
		const value = Array.isArray(raw) ? raw[0] : raw;
		if (!value) {
			res.status(400).json({ message: `Missing path parameter: ${name}` });
			return null;
		}
		out[name] = value;
	}
	return out;
}

/** Read a single query-string value (first of an array), or undefined. */
export function queryValue(
	req: NextApiRequest,
	name: string,
): string | undefined {
	const raw = req.query[name];
	const value = Array.isArray(raw) ? raw[0] : raw;
	return value || undefined;
}

/** Read a header value (first of an array), or undefined. */
export function headerValue(
	req: NextApiRequest,
	name: string,
): string | undefined {
	const raw = req.headers[name.toLowerCase()];
	const value = Array.isArray(raw) ? raw[0] : raw;
	return value || undefined;
}
