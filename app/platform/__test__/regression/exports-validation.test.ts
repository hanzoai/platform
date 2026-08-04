import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPTS_DIR = path.resolve(__dirname, "../../../../pkg/platform/scripts");
const PKG_SRC = path.resolve(__dirname, "../../../../pkg/platform/src");

function parseExports(filePath: string): Record<string, unknown> {
	const content = fs.readFileSync(filePath, "utf-8");
	// Extract the exports object: match from `pkg.exports = {` to the matching `};`
	const start = content.indexOf("pkg.exports = {");
	if (start === -1)
		throw new Error(`Could not find pkg.exports in ${filePath}`);
	const objStart = content.indexOf("{", start);

	// Find matching closing brace by counting depth
	let depth = 0;
	let end = -1;
	for (let i = objStart; i < content.length; i++) {
		if (content[i] === "{") depth++;
		if (content[i] === "}") {
			depth--;
			if (depth === 0) {
				end = i + 1;
				break;
			}
		}
	}
	if (end === -1) throw new Error(`Unmatched braces in ${filePath}`);

	const objLiteral = content.slice(objStart, end);
	// Evaluate the object literal (safe — our own build scripts)
	const fn = new Function(`return ${objLiteral}`);
	return fn();
}

describe("@hanzo/platform switchToDist.js export map", () => {
	const distExports = parseExports(path.join(SCRIPTS_DIR, "switchToDist.js"));

	it("has the base entries every consumer relies on", () => {
		for (const key of [".", "./db", "./db/schema", "./constants"]) {
			expect(distExports).toHaveProperty(key);
		}
	});

	it("has a catch-all ./* entry", () => {
		expect(distExports).toHaveProperty("./*");
	});

	/**
	 * The regression this file exists for. esbuild is configured with
	 * `entryPoints: ["./src/**\/*.ts"]` + `outdir: "./dist"`, so it preserves the
	 * source tree: `src/utils/builders/index.ts` emits to
	 * `dist/utils/builders/index.js`, NOT `dist/utils/builders.js`.
	 *
	 * A wildcard like `"./utils/*": "./dist/utils/*.js"` therefore resolves a
	 * directory import to a file that is never emitted, and the import fails at
	 * runtime in a dist build while working fine in dev (where tsconfig paths
	 * resolve straight to source). Every directory that is imported bare needs
	 * its own explicit entry pointing at `<dir>/index.js`.
	 */
	it("gives every bare-imported directory an explicit index entry", () => {
		const dirEntryPoints = [
			"./templates",
			"./utils/builders",
			"./utils/restore",
			"./services/ci",
		];
		for (const key of dirEntryPoints) {
			expect(
				distExports,
				`${key} must be explicit, not left to a wildcard`,
			).toHaveProperty(key);
			expect(String(distExports[key])).toMatch(/\/index\.js$/);
		}
	});

	it("only claims directory entries that actually have an index", () => {
		for (const key of Object.keys(distExports)) {
			const target = distExports[key];
			if (typeof target !== "string" || !target.endsWith("/index.js")) continue;
			const rel = target.replace(/^\.\/dist\//, "").replace(/\/index\.js$/, "");
			expect(
				fs.existsSync(path.join(PKG_SRC, rel, "index.ts")),
				`${key} -> ${target} but src/${rel}/index.ts does not exist`,
			).toBe(true);
		}
	});
});
