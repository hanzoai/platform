import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard: every `@hanzo/ui` subpath the app imports must be in the
 * package's `exports` map.
 *
 * The original guard checked one symbol (`useHanzoAuth` in the built
 * `@hanzo/ui/navigation` bundle) after a 5.x resolution shipped that subpath
 * without it and `/dashboard` 500'd at SSR. 8.x deletes the subpath outright,
 * which turns that test into a check on a contract that no longer exists — and
 * the app went on importing it, because `types/hanzo-ui.d.ts` declared the
 * module locally so TypeScript never objected. The failure only surfaced at
 * bundle time.
 *
 * So the guard is now the general fact rather than one instance of it: an
 * import path `@hanzo/ui` does not export cannot reach a build. It reads the
 * real source tree and the real installed package, so a version bump that drops
 * a subpath fails here instead of in CI.
 */

const require = createRequire(import.meta.url);

const APP_DIR = path.resolve(__dirname, "../..");
const SOURCE_DIRS = ["components", "pages", "app", "lib", "server", "utils"];
const IMPORT_RE = /from\s+["'](@hanzo\/ui(?:\/[^"']+)?)["']/g;

/** Every `.ts`/`.tsx` file under the app's own source, ignoring build output. */
function sourceFiles(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			return entry.name === "node_modules" || entry.name.startsWith(".")
				? []
				: sourceFiles(full);
		}
		return /\.tsx?$/.test(entry.name) ? [full] : [];
	});
}

/** `@hanzo/ui…` specifiers the app imports, mapped to the files importing them. */
function importedSubpaths(): Map<string, string[]> {
	const found = new Map<string, string[]>();
	for (const dir of SOURCE_DIRS) {
		for (const file of sourceFiles(path.join(APP_DIR, dir))) {
			const text = fs.readFileSync(file, "utf-8");
			for (const [, spec] of text.matchAll(IMPORT_RE)) {
				const at = found.get(spec) ?? [];
				at.push(path.relative(APP_DIR, file));
				found.set(spec, at);
			}
		}
	}
	return found;
}

/** The subpath keys `@hanzo/ui` publishes, as import specifiers. */
function exportedSubpaths(): Set<string> {
	const pkgJsonPath = require.resolve("@hanzo/ui/package.json");
	const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as {
		exports?: Record<string, unknown>;
	};
	return new Set(
		Object.keys(pkg.exports ?? {}).map((key) =>
			key === "." ? "@hanzo/ui" : `@hanzo/ui${key.slice(1)}`,
		),
	);
}

/** `./primitives/*`-style wildcards match any specifier under their prefix. */
function isExported(spec: string, exported: Set<string>): boolean {
	if (exported.has(spec)) return true;
	for (const key of exported) {
		if (!key.includes("*")) continue;
		const [prefix, suffix] = key.split("*") as [string, string];
		if (spec.startsWith(prefix) && spec.endsWith(suffix)) return true;
	}
	return false;
}

describe("@hanzo/ui import paths (bundle contract)", () => {
	const exported = exportedSubpaths();

	it("publishes an exports map", () => {
		expect(exported.size).toBeGreaterThan(0);
	});

	it("exports every subpath the app imports", () => {
		const unexported = [...importedSubpaths()]
			.filter(([spec]) => !isExported(spec, exported))
			.map(([spec, files]) => `${spec} (imported by ${files.join(", ")})`);

		expect(unexported).toEqual([]);
	});
});
