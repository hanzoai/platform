#!/usr/bin/env tsx

/**
 * generate-zap-openapi.ts — emit one OpenAPI 3.1 document per migrated ZAP
 * capability (via `zapgen --emit=openapi`) and merge them into a single
 * composite spec at `openapi.zap.json`.
 *
 * This is the ZAP-native successor to `generate-openapi.ts` (which derives its
 * spec from the tRPC `appRouter` via `generateOpenApiDocument`). As routers are
 * migrated off tRPC onto `@zap-proto/web` capabilities, their surface lives in
 * `server/zap/schema/<name>.zap` and is described here; the tRPC generator keeps
 * covering whatever procedures remain on `appRouter`. When the last tRPC router
 * is gone, this becomes the sole OpenAPI source and `generate-openapi.ts` can be
 * deleted.
 *
 * Each per-schema document is namespaced by its interface name; paths and
 * component schemas are merged with the capability name as a collision guard.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = resolve(__dirname, "../server/zap/schema");
const OUT_PATH = resolve(__dirname, "../../../openapi.zap.json");

interface OpenApiDoc {
	openapi: string;
	info: { title: string; version: string };
	paths: Record<string, unknown>;
	components?: { schemas?: Record<string, unknown> };
}

function main(): void {
	const schemas = readdirSync(SCHEMA_DIR)
		.filter((f) => f.endsWith(".zap"))
		// args/result are shared carriers, not capability interfaces.
		.filter((f) => f !== "args.zap" && f !== "result.zap")
		.sort();

	const work = mkdtempSync(join(tmpdir(), "zap-openapi-"));
	const composite: OpenApiDoc = {
		openapi: "3.1.0",
		info: { title: "Hanzo Platform API (ZAP)", version: "1.0.0" },
		paths: {},
		components: { schemas: {} },
	};

	for (const schema of schemas) {
		const name = schema.replace(/\.zap$/, "");
		try {
			execFileSync(
				"npx",
				["zapgen", "--emit=openapi", "-out", work, join(SCHEMA_DIR, schema)],
				{ stdio: ["ignore", "ignore", "inherit"] },
			);
		} catch {
			// Schemas without an `interface` (pure struct modules) emit nothing —
			// skip them rather than failing the whole composite.
			continue;
		}

		for (const out of readdirSync(work).filter((f) => f.endsWith(".openapi.json"))) {
			const doc = JSON.parse(readFileSync(join(work, out), "utf8")) as OpenApiDoc;
			for (const [path, item] of Object.entries(doc.paths ?? {})) {
				composite.paths[path] = item;
			}
			for (const [ref, def] of Object.entries(doc.components?.schemas ?? {})) {
				// Namespace shared/duplicate component names by capability so two
				// caps that both export e.g. `Result` don't clobber each other.
				const key = composite.components!.schemas![ref] ? `${name}_${ref}` : ref;
				composite.components!.schemas![key] = def;
			}
			rmSync(join(work, out));
		}
	}

	rmSync(work, { recursive: true, force: true });
	writeFileSync(OUT_PATH, `${JSON.stringify(composite, null, 2)}\n`);
	const pathCount = Object.keys(composite.paths).length;
	console.log(`✅ wrote ${OUT_PATH} (${pathCount} paths from ${schemas.length} schemas)`);
}

main();
