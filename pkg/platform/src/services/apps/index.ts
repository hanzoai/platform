/**
 * apps-lifecycle readers (PR 2 of `docs/APPS_LIFECYCLE.md`).
 *
 * Four independent readers populate the observed columns of the `apps` table
 * (PR 1). Each is a pure `() => Promise<{scanned, updated}>` that observes one
 * dimension and writes only its own columns — they run on independent cron
 * (wired in `app/schedules`) and never depend on each other's order:
 *
 *   - `readLatestTag`   → `latest_tag`                  (GHCR)
 *   - `readDeclaredTag` → `declared_tag`                (universe operator CRs)
 *   - `readRunningTag`  → `running_tag` + `health`      (cluster)
 *   - `readReleaseMeta` → `release_url` + `release_assets` (GH Releases)
 *
 * The shared plumbing (Octokit factory, semver math, per-tuple upsert) lives in
 * `./shared`. PR 3's `/v1/apps` endpoint reads the same table; nothing here is
 * coupled to the cron transport.
 */

export { readDeclaredTag } from "./read-declared-tag";
export { readLatestTag } from "./read-latest-tag";
export { readReleaseMeta } from "./read-release-meta";
export { readRunningTag } from "./read-running-tag";
export type { App, Health, ObservedPatch } from "./shared";
export {
	allApps,
	appsReaderOctokit,
	isSemverTag,
	newestSemver,
	parseGhcr,
	parseRepo,
	rollupHealth,
	upsertObserved,
} from "./shared";
