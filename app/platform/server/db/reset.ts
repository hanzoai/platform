import { dbUrl, resolveSqlitePath } from "@hanzo/platform/db";
import BetterSqlite3 from "better-sqlite3";

/**
 * SQLite has no schemas to drop, so we drop every user table (and the
 * drizzle migrations table) instead. FKs are disabled for the duration so
 * drop order doesn't matter, then re-enabled.
 */
const clearDb = (): void => {
	const sqlite = new BetterSqlite3(resolveSqlitePath(dbUrl));
	try {
		sqlite.pragma("foreign_keys = OFF");
		const tables = sqlite
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
			)
			.all() as Array<{ name: string }>;

		const drop = sqlite.transaction(() => {
			for (const { name } of tables) {
				sqlite.prepare(`DROP TABLE IF EXISTS "${name}"`).run();
			}
		});
		drop();

		sqlite.pragma("foreign_keys = ON");
		console.log(`Dropped ${tables.length} tables`);
	} catch (error) {
		console.error("Error cleaning database", error);
		process.exitCode = 1;
	} finally {
		sqlite.close();
	}
};

clearDb();
