/**
 * The ONE export map for @hanzo/platform.
 *
 * `switch:prod` (dist) and `switch:dev` (src) are the same map pointing at two
 * trees, so they are rendered from this single table rather than written twice.
 * They had drifted badly — dist carried 19 entries, src carried 4 — which meant
 * running `switch:dev` silently deleted the resolution for `./lib/auth`,
 * `./services/*`, `./utils/*`, `./templates`, `./db/schema` and the `./*`
 * catch-all. Two hand-maintained copies of one fact.
 *
 * WHY DIRECTORY ENTRIES ARE EXPLICIT. Both builders preserve the source tree
 * (`tsc --outDir`, and esbuild with per-file entry points), so
 * `src/utils/builders/index.ts` emits `dist/utils/builders/index.js` — there is
 * no `dist/utils/builders.js`. A pattern like `"./*": "./dist/*.js"` therefore
 * resolves a bare directory import to a file that is never emitted: it works in
 * dev (tsconfig paths resolve straight to source) and fails only in a dist
 * build. Every directory imported bare needs its own entry pointing at
 * `<dir>/index.js`.
 *
 * The wildcard `./*` subsumes every non-directory subpath — `./lib/auth`,
 * `./services/postgres`, `./utils/ai/select-ai-provider`, `./setup/setup`,
 * `./db/schema/deployment` and so on all render identically through it — so
 * per-directory wildcards (`./utils/*`, `./services/*`, `./utils/ai/*`, …) were
 * exact restatements of it and are gone. One catch-all, one list of exceptions.
 */

/**
 * Directories that are imported bare, e.g. `@hanzo/platform/services/k8s`.
 *
 * Keep this list in step with reality: grep the workspace for
 * `@hanzo/platform/<path>` imports and add any whose target is a directory with
 * an `index.ts`. `__test__/regression/exports-validation.test.ts` fails the
 * build if an entry here has no `index.ts`, and if a bare directory import in
 * the workspace is missing from here.
 */
export const DIRECTORY_ENTRIES = [
	"constants",
	"db",
	"db/schema",
	"services/ci",
	"services/k8s",
	"services/k8s/operator",
	"templates",
	"utils/builders",
	"utils/restore",
];

/**
 * Render the export map for a tree.
 *
 * @param {"src" | "dist"} mode
 * @returns {Record<string, string>}
 */
export function exportsFor(mode) {
	const dir = mode === "src" ? "src" : "dist";
	const ext = mode === "src" ? "ts" : "js";
	/** @param {string} p */
	const mod = (p) => `./${dir}/${p}.${ext}`;

	/** @type {Record<string, string>} */
	const exports = {
		// ESM only. The package is `"type": "module"` and every consumer imports
		// it as such; the old `require: ./dist/index.cjs.js` condition named a
		// file no build has ever emitted, so it could only ever fail — louder to
		// not claim it.
		".": mod("index"),
		"./package.json": "./package.json",
	};

	for (const entry of DIRECTORY_ENTRIES) {
		exports[`./${entry}`] = mod(`${entry}/index`);
	}

	// Catch-all last, so the explicit directory entries above win.
	exports["./*"] = mod("*");

	return exports;
}

/**
 * The `main` field for a tree — for tooling that predates `exports`.
 *
 * @param {"src" | "dist"} mode
 */
export function mainFor(mode) {
	return mode === "src" ? "./src/index.ts" : "./dist/index.js";
}
