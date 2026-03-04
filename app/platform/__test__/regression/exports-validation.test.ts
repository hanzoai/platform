import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPTS_DIR = path.resolve(__dirname, "../../../../packages/server/scripts");

function parseExports(filePath: string): Record<string, unknown> {
	const content = fs.readFileSync(filePath, "utf-8");
	// Extract the exports object: match from `pkg.exports = {` to the matching `};`
	const start = content.indexOf("pkg.exports = {");
	if (start === -1) throw new Error(`Could not find pkg.exports in ${filePath}`);
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

describe("switchToDist.js export map", () => {
	const distExports = parseExports(path.join(SCRIPTS_DIR, "switchToDist.js"));
	const srcExports = parseExports(path.join(SCRIPTS_DIR, "switchToSrc.js"));

	it("has explicit ./utils/builders entry (not just wildcard)", () => {
		expect(distExports).toHaveProperty("./utils/builders");
		const entry = distExports["./utils/builders"] as Record<string, string>;
		expect(entry.import).toContain("builders/index.js");
	});

	it("has ./emails/* wildcard", () => {
		expect(distExports).toHaveProperty("./emails/*");
	});

	it("has ./monitoring/* wildcard", () => {
		expect(distExports).toHaveProperty("./monitoring/*");
	});

	it("has all critical base entries", () => {
		const required = [".", "./db", "./db/schema", "./constants", "./templates"];
		for (const key of required) {
			expect(distExports).toHaveProperty(key);
		}
	});

	it("has wildcard entries for all subpackages", () => {
		const wildcards = [
			"./db/schema/*",
			"./services/*",
			"./lib/*",
			"./setup/*",
			"./templates/*",
			"./utils/*",
			"./types/*",
			"./wss/*",
		];
		for (const key of wildcards) {
			expect(distExports).toHaveProperty(key);
		}
	});

	it("has catch-all ./* entry", () => {
		expect(distExports).toHaveProperty("./*");
	});

	it("switchToSrc has matching keys for every switchToDist key", () => {
		const distKeys = Object.keys(distExports);
		const srcKeys = Object.keys(srcExports);
		for (const key of distKeys) {
			expect(srcKeys).toContain(key);
		}
	});
});
