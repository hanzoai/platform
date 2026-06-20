import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the `/dashboard` 500.
 *
 * DashboardLayout's PlatformHanzoHeader calls `useHanzoAuth()` from
 * `@hanzo/ui/navigation` during SSR. `@hanzo/ui@5.3.36` (the version the
 * lockfile pinned in the v4.1.0 image) shipped a built `dist/navigation`
 * bundle WITHOUT that export, so production SSR threw
 *   `TypeError: (0 , j.useHanzoAuth) is not a function`
 * which Next surfaced as a 500. The export first appears in 5.3.38; the pin
 * was raised to ^5.6.1. This test fails fast if a future resolution drops the
 * export again — so a bad image can never reach the cluster.
 */

const require = createRequire(import.meta.url);

/** Resolve the built file that `@hanzo/ui/navigation` points at. */
function resolveNavigationBundle(): string {
	const pkgJsonPath = require.resolve("@hanzo/ui/package.json");
	const pkgDir = path.dirname(pkgJsonPath);
	const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as {
		exports?: Record<string, { import?: string; require?: string }>;
	};

	const nav = pkg.exports?.["./navigation"];
	if (!nav) {
		throw new Error("@hanzo/ui package.json has no ./navigation export");
	}

	const rel = nav.import ?? nav.require;
	if (!rel) {
		throw new Error("@hanzo/ui ./navigation export has no import/require target");
	}

	return path.resolve(pkgDir, rel);
}

describe("@hanzo/ui/navigation exports (dashboard SSR contract)", () => {
	const bundlePath = resolveNavigationBundle();
	const bundle = fs.readFileSync(bundlePath, "utf-8");

	it("ships a built navigation bundle", () => {
		expect(fs.existsSync(bundlePath)).toBe(true);
	});

	it("exports useHanzoAuth (the symbol DashboardLayout needs at SSR)", () => {
		expect(bundle).toContain("useHanzoAuth");
	});

	it("exports the header + command palette DashboardLayout renders", () => {
		for (const sym of ["HanzoHeader", "HanzoCommandPalette"]) {
			expect(bundle).toContain(sym);
		}
	});
});
