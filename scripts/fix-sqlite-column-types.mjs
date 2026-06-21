// Post-codemod corrector for the Postgres -> SQLite schema migration.
//
// The bulk `pg-to-sqlite-codemod.mjs` pass mis-handled three column shapes.
// This corrector fixes exactly those three, deterministically and
// idempotently, leaving every already-correct column untouched.
//
//   A. Scalar primary keys that were wrongly tagged as JSON arrays.
//      A `text("id").primaryKey().$defaultFn(() => nanoid())` is a scalar
//      string; the codemod rewrote it to `text("id", { mode: "json" })
//      .$type<string[]>()...`. `$defaultFn` returns a string, so the column
//      type and its default disagree. Collapse back to scalar `text(...)`.
//
//   B. Array columns whose JSON mode was dropped. `.array().default([])`
//      became `text("x").notNull().default([])` — a scalar column with a
//      JS-array default. Re-tag with `{ mode: "json" }`, `.$type<string[]>()`,
//      and a SQLite JSON default (`sql`'[]'``).
//
//   C. Self/forward-referencing FK annotations still typed `AnyPgColumn`.
//      Rename to `AnySQLiteColumn` and ensure it is imported from
//      `drizzle-orm/sqlite-core`.
//
// Run: node scripts/fix-sqlite-column-types.mjs

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_DIR = "pkg/platform/src/db/schema";

const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".ts"));

let changed = 0;

for (const file of files) {
	const path = join(SCHEMA_DIR, file);
	let src = readFileSync(path, "utf8");
	const before = src;

	// --- A. Scalar PK wrongly JSON-arrayed -------------------------------
	// Match:
	//   text("<col>", { mode: "json" })
	//     .$type<string[]>()
	//     [.notNull()]
	//     .primaryKey()
	// Collapse the column constructor back to scalar text and drop the
	// `.$type<string[]>()` line. The `.notNull()` / `.primaryKey()` chain and
	// any trailing `.$defaultFn(...)` are preserved verbatim.
	src = src.replace(
		/text\((\s*"[^"]+"|\s*'[^']+')\s*,\s*\{\s*mode:\s*"json"\s*\}\)(\s*)\.\$type<string\[\]>\(\)((?:\s*\.notNull\(\))?\s*\.primaryKey\(\))/g,
		(_m, name, ws, tail) => `text(${name.trim()})${ws}${tail.trimStart() ? `\n\t\t${tail.trim()}` : tail}`,
	);

	// --- B. Array column with a bare JS-array default --------------------
	// `text("<col>")[.notNull()].default([])`  ->
	// `text("<col>", { mode: "json" }).$type<string[]>()[.notNull()]
	//   .default(sql`'[]'`)`
	// Only touches columns whose default is a literal `[]` (the array signal
	// the codemod left behind); scalar columns never have a `[]` default.
	src = src.replace(
		/text\((\s*"[^"]+"|\s*'[^']+')\)((?:\s*\.notNull\(\))?)\s*\.default\(\[\]\)/g,
		(_m, name, notNull) =>
			`text(${name.trim()}, { mode: "json" }).$type<string[]>()${notNull}.default(sql\`'[]'\`)`,
	);

	// --- B2. Array column whose JSON default is `sql`'[]'`` -------------
	// Same class as B, but the codemod emitted the SQLite JSON default while
	// still dropping `{ mode: "json" }` / `.$type<string[]>()`. Only matches
	// the single-line form (`text("x")[.notNull()].default(sql`'[]'`)`);
	// multi-line columns already carry `{ mode: "json" }` on the `text(...)`
	// line, so they are left untouched.
	src = src.replace(
		/text\((\s*"[^"]+"|\s*'[^']+')\)((?:\.notNull\(\))?)\.default\(sql`'\[\]'`\)/g,
		(_m, name, notNull) =>
			`text(${name.trim()}, { mode: "json" }).$type<string[]>()${notNull}.default(sql\`'[]'\`)`,
	);

	// --- C. AnyPgColumn -> AnySQLiteColumn -------------------------------
	if (src.includes("AnyPgColumn")) {
		src = src.replace(/\bAnyPgColumn\b/g, "AnySQLiteColumn");
	}

	if (src !== before) {
		// Ensure AnySQLiteColumn is imported from sqlite-core when used.
		if (
			src.includes("AnySQLiteColumn") &&
			!/import\s*(?:type\s*)?\{[^}]*\bAnySQLiteColumn\b[^}]*\}\s*from\s*["']drizzle-orm\/sqlite-core["']/.test(
				src,
			)
		) {
			src = src.replace(
				/import\s*\{([^}]*)\}\s*from\s*("drizzle-orm\/sqlite-core"|'drizzle-orm\/sqlite-core')/,
				(_m, names, mod) => {
					const list = names
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean);
					if (!list.includes("AnySQLiteColumn")) list.push("AnySQLiteColumn");
					list.sort();
					return `import { ${list.join(", ")} } from ${mod}`;
				},
			);
		}

		// Ensure `sql` is imported when we introduced a sql`` default.
		if (
			/\.default\(sql`/.test(src) &&
			!/import\s*\{[^}]*\bsql\b[^}]*\}\s*from\s*["']drizzle-orm["']/.test(src)
		) {
			if (/import\s*\{[^}]*\}\s*from\s*("drizzle-orm"|'drizzle-orm')/.test(src)) {
				src = src.replace(
					/import\s*\{([^}]*)\}\s*from\s*("drizzle-orm"|'drizzle-orm')/,
					(_m, names, mod) => {
						const list = names
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean);
						if (!list.includes("sql")) list.push("sql");
						list.sort();
						return `import { ${list.join(", ")} } from ${mod}`;
					},
				);
			} else {
				src = `import { sql } from "drizzle-orm";\n${src}`;
			}
		}

		writeFileSync(path, src);
		changed += 1;
		console.log(`fixed ${file}`);
	}
}

console.log(`\n${changed} file(s) corrected.`);
