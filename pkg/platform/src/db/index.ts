import BetterSqlite3 from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import {
	type BetterSQLite3Database,
	drizzle,
} from "drizzle-orm/better-sqlite3";
import { dbUrl } from "./constants";
import * as schema from "./schema";

export { and, eq };
export * from "./schema";

type Database = BetterSQLite3Database<typeof schema>;

/**
 * Resolve a `dbUrl` (which may be a bare path, a `file:`-prefixed URL, or
 * `:memory:`) into the argument better-sqlite3 expects. Exported so the
 * migration and reset entrypoints resolve paths identically — one
 * implementation, no copies.
 */
export function resolveSqlitePath(url: string): string {
	if (url === ":memory:" || url.startsWith("file::memory:")) {
		return ":memory:";
	}
	if (url.startsWith("file:")) {
		// Strip the scheme and any query string (`?cache=shared` etc.).
		// `split` always yields at least one element, so `[0]` is defined;
		// the `?? ""` satisfies noUncheckedIndexedAccess without a non-null `!`.
		return url.slice("file:".length).split("?")[0] ?? "";
	}
	return url;
}

/**
 * Open a SQLite connection with the PRAGMAs platform relies on:
 *   - foreign_keys ON: the schema declares FKs with onDelete actions.
 *     SQLite ignores them unless this is enabled per connection — Postgres
 *     enforced them implicitly, so this preserves referential integrity.
 *   - WAL: readers don't block the single writer.
 *   - busy_timeout: wait rather than throw SQLITE_BUSY under contention.
 */
function openConnection(): Database {
	const sqlite = new BetterSqlite3(resolveSqlitePath(dbUrl));
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	sqlite.pragma("busy_timeout = 5000");
	return drizzle(sqlite, { schema });
}

/**
 * Reuse a single connection across hot reloads in development. We don't use
 * `declare global` to avoid redeclaration clashes in the monorepo.
 */
const globalForDb = globalThis as unknown as {
	db?: Database;
};

let dbConnection: Database;

if (process.env.NODE_ENV === "production") {
	dbConnection = openConnection();
} else {
	if (!globalForDb.db) {
		globalForDb.db = openConnection();
	}
	dbConnection = globalForDb.db;
}

export const db: Database = dbConnection;

export { dbUrl };
