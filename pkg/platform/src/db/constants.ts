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
 *      or `file:/data/platform.db` for a pinned location). Must resolve to a
 *      SQLite path or `:memory:`; a `postgres://` URL is NOT accepted (it would
 *      be opened as a literal filename — see `resolveSqlitePath` in ./index.ts).
 *   2. PLATFORM_DB_PATH — filesystem path to the SQLite file. The deployed
 *      default: `/app/data/platform.db` on a PVC (k8s/platform-statefulset.yaml).
 *   3. Default — `data/platform.db`, the local-dev convention.
 *
 * TENANCY: today this is ONE shared SQLite file with an `organizationId`
 * column on the multi-tenant tables (the connection in ./index.ts is a single
 * singleton). The CTO directive's end-state — one SQLite file per org, the
 * file itself as the tenant boundary, no tenant column — is NOT yet built; it
 * is queued as a follow-up that turns this primitive into a per-org connection
 * factory. Until then, tenant isolation is enforced by org-scoped queries, not
 * by file separation.
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
