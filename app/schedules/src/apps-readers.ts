import type { AppsReaderType } from "./schema.js";

/**
 * Cron wiring for the four apps-lifecycle readers (PR 2 of
 * docs/APPS_LIFECYCLE.md). Each reader runs on its OWN independent cron — the
 * contract requires "four readers running on independent cron" — so this is the
 * single declarative place that maps each reader to its schedule.
 *
 * Defaults are staggered so the four sweeps don't all fire on the same minute
 * (avoids a thundering herd against GHCR / the GH API / the cluster):
 *
 *   - read-latest-tag   every 5 min (GHCR is cheap, and "newest released image"
 *                       is the most time-sensitive drift signal)
 *   - read-declared-tag every 5 min, offset +1 (universe CR changes should
 *                       surface fast)
 *   - read-running-tag  every 2 min (cluster reality is the keystone column;
 *                       cheap in-cluster reads)
 *   - read-release-meta every 15 min, offset +3 (release assets change rarely)
 *
 * Each is overridable via env (`APPS_READER_<TYPE>_CRON`) so ops can retune
 * without a redeploy of code — only a config change. Values are standard
 * 5-field cron expressions (BullMQ `repeat.pattern`).
 */
type ReaderCron = { type: AppsReaderType; cronSchedule: string };

const env = (name: string, fallback: string): string =>
	process.env[name]?.trim() || fallback;

export const APPS_READER_CRONS: ReaderCron[] = [
	{
		type: "read-latest-tag",
		cronSchedule: env("APPS_READER_LATEST_CRON", "*/5 * * * *"),
	},
	{
		type: "read-declared-tag",
		cronSchedule: env("APPS_READER_DECLARED_CRON", "1-59/5 * * * *"),
	},
	{
		type: "read-running-tag",
		cronSchedule: env("APPS_READER_RUNNING_CRON", "*/2 * * * *"),
	},
	{
		type: "read-release-meta",
		cronSchedule: env("APPS_READER_RELEASE_CRON", "3-59/15 * * * *"),
	},
];
