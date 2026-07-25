/**
 * Apps-inventory scheduler — drives the deploy loop's apply and observe passes
 * so the cluster tracks the declared CRs in git and the `apps` table tracks the
 * live cluster + GitHub releases, without manual kubectl or seeding.
 *
 * THREE INDEPENDENT PASSES, each with its OWN timer and its OWN in-flight guard.
 * They are deliberately not chained: apply and releases both call a rate-limited
 * external API (GitHub), and Octokit's throttle plugin SLEEPS rather than throws
 * when the quota is exhausted. While apply was awaited INSIDE the observe tick,
 * that sleep held the observe guard latched, so `if (ticking) return` skipped
 * every following tick and the board silently froze at its last observation while
 * the pod stayed `1/1 Running`. A stall in one pass must only ever stall that
 * pass — which is why the composition here is three timers, not one sequence.
 *
 *   - apply (`applyDeclaredCRs`): git → CR. Pushes the reconcilable declared
 *     `Service` CRs from `hanzoai/universe` into the cluster (the native
 *     replacement for the `gitops-reconcile` cron). Incremental — steady state
 *     is one directory-listing call and zero applies. Ticks every 60s.
 *   - inventory (`syncInventory`): declared (operator CR) + running (Deployment
 *     or StatefulSet) + health, read from the cluster. Cheap, read-mostly and
 *     dependent on NO external API, so it ticks fast (default 60s) and keeps
 *     ticking however GitHub behaves.
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

import { applyDeclaredCRs } from "./apply-declared";
import { syncInventory } from "./inventory";
import { syncReleases } from "./release-reader";

/**
 * The ONE gate for the git→CR apply pass. Default ON in the deploy env; set
 * `PLATFORM_CRS_APPLY=false` to disable apply (keeping observe) without a
 * redeploy — the escape hatch for pausing the native reconcile.
 */
const CRS_APPLY_ENABLED = process.env.PLATFORM_CRS_APPLY !== "false";

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
 * How often to push declared CRs from git (ms, default 60s). Apply keeps its own
 * cadence precisely so it can never pace the observe loop.
 */
const APPLY_INTERVAL_MS = Number.parseInt(
	process.env.APPS_APPLY_INTERVAL_MS || "60000",
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
let applyTicking = false;
let releaseTicking = false;

/**
 * Run one git→CR apply pass, logging the outcome; never throws. Gated by the ONE
 * `PLATFORM_CRS_APPLY` flag. A `source.list()` failure (GitHub unreachable) is
 * logged and swallowed here so it can never skip the observe pass that follows.
 */
export async function applyDeclaredOnce(): Promise<void> {
	if (!CRS_APPLY_ENABLED) return;
	if (applyTicking) return; // skip if the previous apply is still in flight
	applyTicking = true;
	try {
		const s = await bounded("apply", applyDeclaredCRs());
		if (s.unchanged && s.failed.length === 0) return; // steady state — stay quiet
		console.log(
			`[apps-apply] applied ${s.applied.length} CR(s)` +
				(s.applied.length ? ` (${s.applied.join(", ")})` : "") +
				`; skipped ${s.skipped}` +
				(s.failed.length
					? `; ${s.failed.length} failed: ${s.failed
							.map((f) => `${f.name}=${f.error}`)
							.join("; ")}`
					: ""),
		);
	} catch (err) {
		console.error("[apps-apply] apply pass failed", err);
	} finally {
		applyTicking = false;
	}
}

/** Run one observe pass (cluster → apps table), logging the outcome; never throws. */
export async function runInventoryOnce(): Promise<void> {
	if (ticking) return; // skip if the previous tick is still in flight
	ticking = true;
	try {
		const results = await bounded("inventory", syncInventory());
		const total = results.reduce((n, r) => n + r.upserted, 0);
		// Pruning is a DELETE — surface it whenever it happens so a row leaving the
		// board is always attributable to a tick, never a silent disappearance.
		const pruned = results.reduce((n, r) => n + r.pruned, 0);
		console.log(
			`[apps-inventory] synced ${total} apps across ${results.length} cluster(s): ` +
				results.map((r) => `${r.cluster}=${r.upserted}`).join(", ") +
				(pruned ? `; pruned ${pruned} stale row(s)` : ""),
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
		`[apps-inventory] scheduler starting (apply=${CRS_APPLY_ENABLED ? "on" : "off"} ` +
			`every ${APPLY_INTERVAL_MS}ms, inventory every ${INTERVAL_MS}ms, ` +
			`releases every ${RELEASE_INTERVAL_MS}ms)`,
	);

	// Inventory first so the apps table is populated before releases are read.
	void runInventoryOnce();
	const handle = setInterval(() => void runInventoryOnce(), INTERVAL_MS);
	if (typeof handle.unref === "function") handle.unref();

	// Apply on its OWN timer, never awaited by observe. It calls a rate-limited
	// external API (GitHub); when that throttles, octokit SLEEPS rather than
	// throwing, so awaiting apply inside the observe tick held `ticking` true and
	// froze the cluster read for as long as the rate-limit window lasted — the
	// board silently stopped tracking the fleet. Separate timers, separate guards:
	// a GitHub stall can now only ever stall apply.
	void applyDeclaredOnce();
	const aHandle = setInterval(
		() => void applyDeclaredOnce(),
		APPLY_INTERVAL_MS,
	);
	if (typeof aHandle.unref === "function") aHandle.unref();

	// Release reader: a short initial delay lets the leading inventory pass land
	// the repos first, then it ticks on its own slow cadence.
	const kickReleases = setTimeout(() => {
		void runReleasesOnce();
		const rHandle = setInterval(
			() => void runReleasesOnce(),
			RELEASE_INTERVAL_MS,
		);
		if (typeof rHandle.unref === "function") rHandle.unref();
	}, 5000);
	if (typeof kickReleases.unref === "function") kickReleases.unref();
}
