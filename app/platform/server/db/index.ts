/**
 * The platform app shares one SQLite connection with the @hanzo/platform
 * package — constructed once, with the right PRAGMAs (foreign_keys, WAL,
 * busy_timeout), in `pkg/platform/src/db/index.ts`. Re-export it here so
 * both `@/server/db` and `@hanzo/platform/db` resolve to the same instance.
 */
export { and, db, dbUrl, eq } from "@hanzo/platform/db";
