import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
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
	// Fail closed on a network-database URL. Platform's datastore is Base
	// SQLite; a `postgres://`/`mysql://` URL here is a misconfiguration (e.g. a
	// stale `${db.DATABASE_URL}` injection). Returning it verbatim would make
	// better-sqlite3 open a file literally named "postgres://host/db" — a junk
	// path that succeeds, yielding a silent EMPTY database. Throwing turns that
	// data-loss footgun into a loud boot failure a healthcheck catches.
	const scheme = url.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1];
	if (scheme) {
		throw new Error(
			`Platform datastore is SQLite; refusing a "${scheme}://" URL. ` +
				`Set PLATFORM_DB_PATH to a file path or ":memory:", or ` +
				`DATABASE_URL to a "file:" SQLite URL. A network-database URL ` +
				`would be opened as a literal filename and silently create an ` +
				`empty database.`,
		);
	}
	return url;
}

/**
 * Ensure the parent directory of a file-backed SQLite path exists.
 *
 * Postgres connected over the network, so nothing on disk had to pre-exist.
 * better-sqlite3 will create the database file itself, but it cannot create
 * missing parent directories — on a fresh container or a freshly-mounted PVC,
 * `data/platform.db` fails with "Cannot open database because the directory
 * does not exist". Creating it here makes opening robust everywhere (runtime,
 * migration, Next.js build-time page-data collection). No-op for `:memory:`.
 *
 * Exported so the migration and reset entrypoints share the same behaviour.
 */
export function ensureSqliteDir(path: string): void {
	if (path === ":memory:") {
		return;
	}
	mkdirSync(dirname(path), { recursive: true });
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
	const path = resolveSqlitePath(dbUrl);
	ensureSqliteDir(path);
	const sqlite = new BetterSqlite3(path);
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
