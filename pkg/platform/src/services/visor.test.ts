/**
 * Every path this client names is a route visor registers.
 *
 * These calls went to `/api/…` — a prefix visor has never served — so all
 * eleven 404d. The table below is read out of visor's own router rather than
 * written down here, because a copy would drift the same way.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CLIENT = join(import.meta.dirname, "visor.ts");
const ROUTER =
	process.env.VISOR_SOURCE ?? join(homedir(), "work", "hanzo", "visor", "routers", "router.go");

/** The paths visor.ts asks for, with a row address reduced to its template. */
function called(): string[] {
	const src = readFileSync(CLIENT, "utf8");
	const literal = [...src.matchAll(/visorFetch<[^>]*>\("([^"]+)"/g)].map((m) => m[1]);
	const rows = [...src.matchAll(/visorFetch<[^>]*>\(row\("(\w+)"/g)].map(
		(m) => `/v1/${m[1]}/:owner/:name`,
	);
	return [...literal, ...rows];
}

/** The (method, path) pairs visor.ts asks for. */
function calls(): Array<[string, string]> {
	const src = readFileSync(CLIENT, "utf8");
	const out: Array<[string, string]> = [];
	for (const m of src.matchAll(
		/visorFetch<[^>]*>\((?:"([^"]+)"|row\("(\w+)"[^)]*\)),\s*token,?\s*(\{[^;]*?\})?\s*\)/gs,
	)) {
		const path = m[1] ?? `/v1/${m[2]}/:owner/:name`;
		const method = /method:\s*"(\w+)"/.exec(m[3] ?? "")?.[1] ?? "GET";
		out.push([method, path]);
	}
	return out;
}

/** The (method, path) pairs visor registers. */
function served(): Set<string> {
	const src = readFileSync(ROUTER, "utf8");
	return new Set(
		[...src.matchAll(/app\.(Get|Post|Put|Patch|Delete)\("([^"]+)"/g)].map(
			(m) => `${m[1].toUpperCase()} ${m[2]}`,
		),
	);
}

describe("the visor client", () => {
	it("names no /api/ path", () => {
		expect(called().filter((p) => p.startsWith("/api/"))).toEqual([]);
	});

	it("names only /v1 paths", () => {
		expect(called().filter((p) => !p.startsWith("/v1/"))).toEqual([]);
	});

	it.skipIf(!existsSync(ROUTER))("names only routes visor registers", () => {
		const routes = served();
		expect(routes.size).toBeGreaterThan(0);
		const missing = calls()
			.map(([method, path]) => `${method} ${path}`)
			.filter((k) => !routes.has(k));
		expect(missing).toEqual([]);
	});

	it("addresses a row by (owner, name), never by an id in a query", () => {
		const src = readFileSync(CLIENT, "utf8");
		expect(src).not.toMatch(/params:\s*\{\s*id:/);
	});
});
