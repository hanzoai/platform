/**
 * SQLite connection resolution for platform's internal datastore.
 *
 * Platform is a Hanzo-internal app: it runs on Base SQLite per the CTO
 * architecture directive. There are no network credentials and no
 * plaintext-password fallback (that whole class of risk is gone with the
 * Postgres driver).
 *
 * Resolution order:
 *   1. DATABASE_URL  — explicit override. Accepts a bare path or a
 *      `file:`-prefixed URL (e.g. `file::memory:?cache=shared` for tests,
 *      or `file:/data/platform.db` for a pinned location).
 *   2. PLATFORM_DB_PATH — filesystem path to the SQLite file.
 *   3. Default — `data/platform.db`, the local-dev convention.
 *
 * Per-tenant Base instances (one SQLite per org) are layered on top of this
 * primitive by the connection factory in `./index.ts`.
 */

const { DATABASE_URL, PLATFORM_DB_PATH } = process.env;

function resolveDbUrl(): string {
	if (DATABASE_URL) {
		return DATABASE_URL;
	}
	if (PLATFORM_DB_PATH) {
		return PLATFORM_DB_PATH;
	}
	return "data/platform.db";
}

export const dbUrl: string = resolveDbUrl();
