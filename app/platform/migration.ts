import { dbUrl, ensureSqliteDir, resolveSqlitePath } from "@hanzo/platform/db";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const dbPath = resolveSqlitePath(dbUrl);
ensureSqliteDir(dbPath);
const sqlite = new BetterSqlite3(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite);

try {
	migrate(db, { migrationsFolder: "drizzle" });
	console.log("Migration complete");
} catch (error) {
	console.error("Migration failed", error);
	process.exitCode = 1;
} finally {
	sqlite.close();
}
