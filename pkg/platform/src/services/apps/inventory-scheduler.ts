/**
 * Apps-inventory scheduler — keeps the `apps` table tracking the live fleet and
 * GitHub releases, without manual kubectl or seeding.
 *
 * TWO INDEPENDENT PASSES, each with its OWN timer and its OWN in-flight guard.
 * They are deliberately not chained: releases call a rate-limited external API
 * (GitHub), and Octokit's throttle plugin SLEEPS rather than throws when the
 * quota is exhausted. Awaited inside the observe tick, that sleep held the
 * observe guard latched, so `if (ticking) return` skipped every following tick
 * and the board silently froze at its last observation while the pod stayed
 * `1/1 Running`. A stall in one pass must only ever stall that pass — which is
 * why the composition here is separate timers, not one sequence.
 *
 *   - inventory (`syncInventory`): the fleet pass — declared (operator CR) +
 *     running (Deployment or StatefulSet) + health from every directly-readable
 *     cluster, folded with what CD reports for every other cluster. Cheap,
 *     read-only and dependent on NO external API, so it ticks fast (default 60s)
 *     and keeps ticking however GitHub behaves.
 *   - release-meta (`syncReleases`): latest released tag + release-url +
 *     asset-count, read from the GitHub Releases API. This is the third tag the
 *     drift view compares — without it every row is an opaque `no-release`.
 *     It hits an external rate-limited API and releases change rarely, so it
 *     ticks slowly (default 10m) and only AFTER the first inventory pass has
 *     discovered the repos to look up.
 *
 * Mirrors the billing-job scheduler pattern (`billing/billing-job.ts`):
 * idempotent start (a module-level guard makes a second call a no-op), a leading
 * run, then `setInterval`. apply is create-or-update only (never prunes); the
 * observe passes write only platform's own SQLite.
 *
 * Started from the custom server (`server/server.ts`) when the platform runs
 * in-cluster. Failures are logged and swallowed — a transient cluster blip or a
 * GitHub hiccup must never crash the server or stop future ticks.
 */

import { syncInventory } from "./inventory";
import { syncReleases } from "./release-reader";

/** How often to reconcile declared/running/health from the cluster (ms). */
const INTERVAL_MS = Number.parseInt(
	process.env.APPS_INVENTORY_INTERVAL_MS || "60000",
	10,
);

/** How often to reconcile latest-release facts from GitHub (ms, default 10m). */
const RELEASE_INTERVAL_MS = Number.parseInt(
	process.env.APPS_RELEASE_INTERVAL_MS || "600000",
	10,
);

/**
 * Hard cap on a single pass (ms). A pass that outruns this is ABANDONED so its
 * in-flight guard is released and the next tick can run.
 *
 * WHY this exists (observed in prod): every pass is an unbounded `await` on a
 * remote API — the k8s apiserver via client-go, GitHub via Octokit — and neither
 * client sets a default request timeout. One socket that never answers leaves the
 * guard latched `true` forever, so `if (ticking) return` silently skips every
 * subsequent tick and the board freezes at whatever it last observed while the
 * pod stays happily `1/1 Running`. Verified live: inventory ticked once a minute,
 * then stopped dead at 21:52 with no error and no further log line — a stall that
 * is invisible precisely because nothing crashed. A watchdog turns a permanent
 * silent freeze into a logged, self-healing skip.
 */
const TICK_TIMEOUT_MS = Number.parseInt(
	process.env.APPS_TICK_TIMEOUT_MS || "45000",
	10,
);

/**
 * Race a pass against the watchdog. The abandoned promise keeps running (there is
 * nothing to cancel — the underlying clients expose no abort), but the guard is
 * freed, so a wedged pass costs one skipped tick instead of the whole loop.
 */
async function bounded<T>(label: string, work: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const watchdog = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(new Error(`${label} exceeded ${TICK_TIMEOUT_MS}ms — abandoned`)),
			TICK_TIMEOUT_MS,
		);
	});
	try {
		return await Promise.race([work, watchdog]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

let started = false;
let ticking = false;
let releaseTicking = false;

/** Run one observe pass (cluster → apps table), logging the outcome; never throws. */
export async function runInventoryOnce(): Promise<void> {
	if (ticking) return; // skip if the previous tick is still in flight
	ticking = true;
	try {
		const r = await bounded("inventory", syncInventory());
		const clusters = Object.entries(r.byCluster);
		// Pruning is a DELETE — surface it whenever it happens so a row leaving the
		// board is always attributable to a tick, never a silent disappearance.
		console.log(
			`[apps-inventory] synced ${r.upserted} apps across ${clusters.length} cluster(s): ` +
				clusters.map(([c, n]) => `${c}=${n}`).join(", ") +
				(r.pruned ? `; pruned ${r.pruned} stale row(s)` : ""),
		);
	} catch (err) {
		console.error("[apps-inventory] sync failed", err);
	} finally {
		ticking = false;
	}
}

/** Run one release-meta sync pass, logging the outcome; never throws. */
export async function runReleasesOnce(): Promise<void> {
	if (releaseTicking) return;
	releaseTicking = true;
	try {
		const { repos, updated } = await bounded("releases", syncReleases());
		console.log(
			`[apps-release] synced release meta for ${repos} repo(s); ${updated} row(s) updated`,
		);
	} catch (err) {
		console.error("[apps-release] sync failed", err);
	} finally {
		releaseTicking = false;
	}
}

/** Start the scheduler (idempotent): leading runs + intervals for both readers. */
export function startInventoryScheduler(): void {
	if (started) return;
	started = true;
	console.log(
		`[apps-inventory] scheduler starting (inventory every ${INTERVAL_MS}ms, ` +
			`releases every ${RELEASE_INTERVAL_MS}ms)`,
	);

	const handle = setInterval(() => void runInventoryOnce(), INTERVAL_MS);
	if (typeof handle.unref === "function") handle.unref();

	// The release reader looks up the repos the INVENTORY pass discovers, so its
	// leading run waits for that pass to FINISH — the dependency expressed as a
	// dependency, not as a sleep. The old form guessed 5s, which on a fresh
	// database (an empty `apps` table, e.g. right after a migration) ran against
	// zero rows, logged `synced release meta for 0 repo(s)`, and then slept the
	// full 10-minute interval with the board's third tag blank the whole time.
	//
	// Only the LEADING run is ordered. After that the two tick independently, so
	// a stalled release pass can still never pace the cluster read.
	void runInventoryOnce().then(() => {
		void runReleasesOnce();
		const rHandle = setInterval(
			() => void runReleasesOnce(),
			RELEASE_INTERVAL_MS,
		);
		if (typeof rHandle.unref === "function") rHandle.unref();
	});
}
