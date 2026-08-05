import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// The ONE table both switch scripts render. Testing it directly (rather than
// re-parsing the generated package.json out of each script's source) is what
// makes "src and dist agree" checkable at all.
import {
	DIRECTORY_ENTRIES,
	exportsFor,
} from "../../../../pkg/platform/scripts/exports-map.js";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PKG_SRC = path.join(REPO_ROOT, "pkg/platform/src");

const distExports = exportsFor("dist");
const srcExports = exportsFor("src");

describe("@hanzo/platform export map", () => {
	it("has the base entries every consumer relies on", () => {
		for (const key of [".", "./db", "./db/schema", "./constants"]) {
			expect(distExports).toHaveProperty(key);
		}
	});

	it("has a catch-all ./* entry", () => {
		expect(distExports).toHaveProperty("./*");
		expect(srcExports).toHaveProperty("./*");
	});

	/**
	 * The divergence this file now exists for. `switch:dev` and `switch:prod`
	 * are one map over two trees, but they used to be two hand-written literals
	 * — dist grew to 19 entries while src still had 4, so running `switch:dev`
	 * silently deleted the resolution for `./lib/auth`, `./services/*`,
	 * `./templates`, `./db/schema` and the `./*` catch-all.
	 */
	it("resolves the same subpaths in src and dist", () => {
		expect(Object.keys(srcExports).sort()).toEqual(
			Object.keys(distExports).sort(),
		);
	});

	it("points each tree at its own files", () => {
		for (const [key, target] of Object.entries(distExports)) {
			if (key === "./package.json") continue;
			expect(target, key).toMatch(/^\.\/dist\/.*\.js$/);
		}
		for (const [key, target] of Object.entries(srcExports)) {
			if (key === "./package.json") continue;
			expect(target, key).toMatch(/^\.\/src\/.*\.ts$/);
		}
	});

	/**
	 * Both builders preserve the source tree, so `src/utils/builders/index.ts`
	 * emits `dist/utils/builders/index.js` and never `dist/utils/builders.js`.
	 * A wildcard therefore resolves a bare directory import to a file that is
	 * never emitted — it works in dev (tsconfig paths hit source directly) and
	 * fails only in a dist build.
	 */
	it("gives every bare-imported directory an explicit index entry", () => {
		for (const dir of DIRECTORY_ENTRIES) {
			const key = `./${dir}`;
			expect(distExports, `${key} must be explicit`).toHaveProperty(key);
			expect(String(distExports[key])).toMatch(/\/index\.js$/);
			expect(String(srcExports[key])).toMatch(/\/index\.ts$/);
		}
	});

	it("only claims directory entries that actually have an index", () => {
		for (const dir of DIRECTORY_ENTRIES) {
			expect(
				fs.existsSync(path.join(PKG_SRC, dir, "index.ts")),
				`./${dir} is declared but src/${dir}/index.ts does not exist`,
			).toBe(true);
		}
	});
});

/** Every `.ts`/`.tsx` file in the workspace, skipping build and dep output. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (
			entry.name === "node_modules" ||
			entry.name === "dist" ||
			entry.name === ".next" ||
			entry.name.startsWith(".")
		) {
			continue;
		}
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) sourceFiles(full, out);
		else if (/\.tsx?$/.test(entry.name)) out.push(full);
	}
	return out;
}

/**
 * The test that would have caught `@hanzo/platform/services/k8s`.
 *
 * The earlier fix added explicit entries for the four directories that were
 * broken at the time; `services/k8s` and `services/k8s/operator` were imported
 * bare too and stayed broken, because nothing checked the map against what the
 * workspace actually imports. This derives the requirement from the imports
 * instead of from a hand-kept list.
 */
describe("@hanzo/platform bare directory imports", () => {
	it("are all declared in the export map", () => {
		const imported = new Set<string>();
		for (const dir of ["app", "pkg", "e2e"]) {
			const root = path.join(REPO_ROOT, dir);
			if (!fs.existsSync(root)) continue;
			for (const file of sourceFiles(root)) {
				const text = fs.readFileSync(file, "utf-8");
				for (const m of text.matchAll(/["']@hanzo\/platform\/([^"']+)["']/g)) {
					const subpath = m[1];
					if (subpath) imported.add(subpath);
				}
			}
		}

		const bareDirectories = [...imported].filter((subpath) =>
			fs.existsSync(path.join(PKG_SRC, subpath, "index.ts")),
		);
		// Sanity: the scan found real imports, so an empty result can't pass.
		expect(bareDirectories.length).toBeGreaterThan(0);

		const undeclared = bareDirectories.filter(
			(subpath) => !DIRECTORY_ENTRIES.includes(subpath),
		);
		expect(
			undeclared,
			`imported bare but resolved by the ./* wildcard to a file no build emits: ${undeclared.join(", ")}`,
		).toEqual([]);
	});
});
