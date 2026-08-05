#!/usr/bin/env tsx

/**
 * Write the checked-in `openapi.json` — the document the docs site consumes.
 *
 * The document itself is built by `server/api/openapi-document.ts`, the same
 * builder the running instance serves from, so the published file and the live
 * one cannot describe different APIs. This script only chooses the public base
 * URL and decides where the bytes land.
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiDocument } from "../server/api/openapi-document";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function generateOpenAPI() {
	try {
		console.log("🔄 Generating OpenAPI specification...");

		const openApiDocument = buildOpenApiDocument({
			baseUrl: "https://platform.hanzo.ai/v1",
		});

		const outputPath = resolve(__dirname, "../../../openapi.json");
		writeFileSync(
			outputPath,
			JSON.stringify(openApiDocument, null, 2),
			"utf-8",
		);

		console.log("✅ OpenAPI specification generated successfully!");
		console.log(`📄 Output: ${outputPath}`);
		console.log(
			`📊 Endpoints: ${Object.keys(openApiDocument.paths || {}).length}`,
		);
	} catch (error) {
		console.error("❌ Error generating OpenAPI specification:", error);
		process.exit(1);
	} finally {
		process.exit(0);
	}
}

generateOpenAPI();
