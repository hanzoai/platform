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

/** The paths visor.ts asks for. */
function called(): string[] {
	const src = readFileSync(CLIENT, "utf8");
	return [...src.matchAll(/visorFetch<[^>]*>\("([^"]+)"/g)].map((m) => m[1]);
}

/** The paths visor registers. */
function served(): Set<string> {
	const src = readFileSync(ROUTER, "utf8");
	return new Set([...src.matchAll(/app\.(?:Get|Post|Put|Patch|Delete)\("([^"]+)"/g)].map((m) => m[1]));
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
		expect(called().filter((p) => !routes.has(p))).toEqual([]);
	});
});
