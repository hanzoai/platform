#!/usr/bin/env node
/**
 * Deterministic Postgres -> SQLite schema codemod for @hanzo/platform.
 *
 * Two passes over pkg/platform/src/db/schema/*.ts:
 *
 *   Pass 1 — build a GLOBAL enum registry. pgEnum values are declared in one
 *            file (e.g. shared.ts) but consumed across many. We collect every
 *            `export const Name = pgEnum("db", [ ... ])` first so usages can be
 *            inlined no matter which file they live in.
 *
 *   Pass 2 — transform each file: rewrite pg-core builders to sqlite-core,
 *            inline enum usages as `text(col, { enum: [...] })`, drop the now
 *            dangling enum imports/decls, fix the import line.
 *
 * Mapping (grounded in the actual schema):
 *   import "drizzle-orm/pg-core"        -> "drizzle-orm/sqlite-core"
 *   pgTable(                            -> sqliteTable(
 *   EnumVar("col")                     -> text("col", { enum: [...] })   (any file)
 *   serial("c") / serial()             -> integer("c") / integer()       (off-PK token)
 *   boolean("c")                       -> integer("c", { mode: "boolean" })
 *   timestamp("c", {..}) / timestamp("c") -> integer("c", { mode: "timestamp_ms" })
 *   json("c") / jsonb("c")            -> text("c", { mode: "json" })
 *   numeric("c", {..}) / numeric("c")  -> text("c")            (money-safe string)
 *   bigint("c",{mode:"number"})       -> integer("c")
 *   bigint("c",{mode:"bigint"})       -> blob("c", { mode: "bigint" })
 *   uuid("c").defaultRandom()         -> text("c").$defaultFn(() => crypto.randomUUID())
 *   uuid("c")                          -> text("c")
 *   <builder>(...).array()             -> base becomes text({mode:"json"}), .array() dropped
 *   cidr/time/varchar/char             -> text
 *   .defaultNow()                      -> .$defaultFn(() => new Date())
 *   sql`ARRAY[]::text[]`               -> sql`'[]'`
 *
 * Idempotent: a file with no pg-core import is left untouched.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_DIR = join(process.cwd(), "pkg/platform/src/db/schema");

/** sqlite-core free-function builders we may need to import. */
const SQLITE_CORE_BUILDERS = [
	"sqliteTable",
	"text",
	"integer",
	"real",
	"blob",
	"index",
	"uniqueIndex",
	"unique",
	"primaryKey",
	"foreignKey",
	"check",
];

function listSchemaFiles() {
	return readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".ts"));
}

function parsePgCoreImport(src) {
	// The import body is a flat name list with no nested braces, so [^}]
	// keeps the match from crossing into a preceding/following import
	// statement (e.g. the `import { relations } from "drizzle-orm"` line).
	const re =
		/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']drizzle-orm\/pg-core["'];?/;
	const m = src.match(re);
	if (!m) return null;
	return { match: m[0] };
}

/**
 * Collect `export const Name = pgEnum("db", [ ... ])` -> Name => "[...]".
 * Strips `//` line comments (some enum value lists annotate each member)
 * before collapsing whitespace, so the inlined literal stays valid.
 */
function normalizeValues(raw) {
	return raw
		.replace(/\/\/[^\n]*/g, "") // drop line comments
		.replace(/\s+/g, " ")
		.replace(/,\s*\]/, " ]") // tidy trailing comma before close
		.trim();
}

function collectEnums(src, into) {
	const re =
		/export\s+const\s+(\w+)\s*=\s*pgEnum\(\s*["'][^"']+["']\s*,\s*(\[[\s\S]*?\])\s*\)\s*;/g;
	let m;
	while ((m = re.exec(src)) !== null) {
		into.set(m[1], normalizeValues(m[2]));
	}
}

function buildGlobalEnumRegistry() {
	const registry = new Map();
	for (const f of listSchemaFiles()) {
		collectEnums(readFileSync(join(SCHEMA_DIR, f), "utf8"), registry);
	}
	return registry;
}

/**
 * Remove enum names from a `... } from "./shared"` style import block, keeping
 * everything else (type imports, *Schema validators). Only enum value names
 * (the ones in the global registry) are stripped, and only when imported as a
 * plain value (not `type X`).
 */
function stripEnumImports(src, enumNames) {
	return src.replace(
		/import\s+\{([^}]*)\}\s+from\s+(["']\.\/[^"']+["']);?/g,
		(full, body, from) => {
			const parts = body
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			const kept = parts.filter((p) => {
				// Keep `type X`, keep anything not a known enum value name.
				if (p.startsWith("type ")) return true;
				return !enumNames.has(p);
			});
			if (kept.length === parts.length) return full; // nothing removed
			if (kept.length === 0) return ""; // whole import was enums
			return `import {\n\t${kept.join(",\n\t")},\n} from ${from};`;
		},
	);
}

function transform(src, enums) {
	const pg = parsePgCoreImport(src);
	if (!pg) return null;

	let out = src;

	// 1. Remove local pgEnum declarations (single- or multi-line).
	out = out.replace(
		/export\s+const\s+\w+\s*=\s*pgEnum\(\s*["'][^"']+["']\s*,\s*\[[\s\S]*?\]\s*\)\s*;\n?/g,
		"",
	);

	// 2a. Replace `<enumVar>.enumValues` (used to derive zod enums) with the
	//     literal values array `as const`. sqlite-core text(enum) columns have
	//     no standalone .enumValues accessor.
	for (const [name, values] of enums) {
		const accessorRe = new RegExp(`\\b${name}\\.enumValues\\b`, "g");
		out = out.replace(accessorRe, `${values} as const`);
	}

	// 2b. Inline EVERY enum usage from the global registry: Name("col") form.
	for (const [name, values] of enums) {
		const usageRe = new RegExp(
			`\\b${name}\\(\\s*(["'][^"']+["'])\\s*\\)`,
			"g",
		);
		out = out.replace(usageRe, (_f, col) => `text(${col}, { enum: ${values} })`);
	}

	// 3. Drop dangling enum imports from sibling modules (./shared etc.).
	out = stripEnumImports(out, new Set(enums.keys()));

	// 4. pgTable -> sqliteTable.
	out = out.replace(/\bpgTable\(/g, "sqliteTable(");

	// 5. boolean("c") -> integer("c", { mode: "boolean" })  (multi-line safe).
	out = out.replace(
		/\bboolean\(\s*(["'][^"']+["'])\s*,?\s*\)/g,
		'integer($1, { mode: "boolean" })',
	);

	// 6. timestamp("c", {..}) / timestamp("c") -> integer ts_ms (multi-line).
	out = out.replace(
		/\btimestamp\(\s*(["'][^"']+["'])\s*(?:,\s*\{[\s\S]*?\}\s*)?\)/g,
		'integer($1, { mode: "timestamp_ms" })',
	);

	// 7. json / jsonb -> text("c", { mode: "json" }).
	out = out.replace(
		/\bjsonb?\(\s*(["'][^"']+["'])\s*\)/g,
		'text($1, { mode: "json" })',
	);

	// 8. numeric -> text (money-safe). Handles options object.
	out = out.replace(
		/\bnumeric\(\s*(["'][^"']+["'])\s*(?:,\s*\{[\s\S]*?\}\s*)?\)/g,
		"text($1)",
	);

	// 9. bigint modes.
	out = out.replace(
		/\bbigint\(\s*(["'][^"']+["'])\s*,\s*\{\s*mode:\s*"number"\s*\}\s*\)/g,
		"integer($1)",
	);
	out = out.replace(
		/\bbigint\(\s*(["'][^"']+["'])\s*,\s*\{\s*mode:\s*"bigint"\s*\}\s*\)/g,
		'blob($1, { mode: "bigint" })',
	);
	out = out.replace(/\bbigint\(\s*(["'][^"']+["'])\s*\)/g, "integer($1)");

	// 10. serial (off-PK monotonic token) -> integer; named and inferred forms.
	out = out.replace(/\bserial\(\s*(["'][^"']+["'])\s*\)/g, "integer($1)");
	out = out.replace(/\bserial\(\s*\)/g, "integer()");

	// 11. uuid("c").defaultRandom() / uuid("c").
	out = out.replace(
		/\buuid\(\s*(["'][^"']+["'])\s*\)\.defaultRandom\(\)/g,
		"text($1).$defaultFn(() => crypto.randomUUID())",
	);
	out = out.replace(/\buuid\(\s*(["'][^"']+["'])\s*\)/g, "text($1)");

	// 12. cidr/time/varchar/char -> text.
	out = out.replace(/\b(?:cidr|time)\(\s*(["'][^"']+["'])\s*\)/g, "text($1)");
	out = out.replace(
		/\b(?:varchar|char)\(\s*(["'][^"']+["'])\s*(?:,\s*\{[\s\S]*?\}\s*)?\)/g,
		"text($1)",
	);

	// 13. .array() — turn the base text(...) into a JSON column, drop .array().
	//     Single-line text("c").array() and text("c", {..}).array().
	out = out.replace(
		/\btext\(\s*(["'][^"']+["'])\s*\)\.array\(\)/g,
		'text($1, { mode: "json" }).$type<string[]>()',
	);
	out = out.replace(
		/\btext\(\s*(["'][^"']+["'])\s*,\s*\{\s*mode:\s*"json"\s*\}\s*\)\.array\(\)/g,
		'text($1, { mode: "json" }).$type<string[]>()',
	);
	// Multi-line chains: a text(...) whose chain has `.array()` on its own line.
	// Inject mode:json into that text(...) and drop the .array() line.
	out = out.replace(
		/\btext\(\s*(["'][^"']+["'])\s*\)([\s\S]*?)\n\s*\.array\(\)/g,
		'text($1, { mode: "json" }).$type<string[]>()$2',
	);
	// Any straggler `.array()` (already-json base) -> drop.
	out = out.replace(/\n\s*\.array\(\)/g, "");
	out = out.replace(/\.array\(\)/g, "");

	// 14. ARRAY[]::text[] default -> empty JSON array literal.
	out = out.replace(/sql`ARRAY\[\]::text\[\]`/g, "sql`'[]'`");

	// 15. .defaultNow() -> .$defaultFn(() => new Date()).
	out = out.replace(/\.defaultNow\(\)/g, ".$defaultFn(() => new Date())");

	// 16. Rebuild the import: which sqlite-core builders are used as free fns
	//     (not methods — exclude `.builder(`).
	const used = [];
	for (const b of SQLITE_CORE_BUILDERS) {
		const re = new RegExp(`(^|[^.\\w])${b}\\(`, "m");
		if (re.test(out)) used.push(b);
	}
	used.sort();
	if (used.length === 0) {
		// File used pg-core only for pgEnum (now inlined/removed): drop the
		// import entirely rather than emit an empty `import {} from ...`.
		out = out.replace(`${pg.match}\n`, "");
		out = out.replace(pg.match, "");
	} else {
		const newImport = `import {\n\t${used.join(
			",\n\t",
		)},\n} from "drizzle-orm/sqlite-core";`;
		out = out.replace(pg.match, newImport);
	}

	return out;
}

function main() {
	const onlyFile = process.argv[2];
	const enums = buildGlobalEnumRegistry();
	const files = listSchemaFiles().filter((f) => !onlyFile || f === onlyFile);
	let changed = 0;
	for (const f of files) {
		const path = join(SCHEMA_DIR, f);
		const src = readFileSync(path, "utf8");
		const out = transform(src, enums);
		if (out && out !== src) {
			writeFileSync(path, out);
			changed++;
			console.log(`migrated: ${f}`);
		}
	}
	console.log(`\n${changed} file(s) migrated (enum registry: ${enums.size}).`);
}

main();
