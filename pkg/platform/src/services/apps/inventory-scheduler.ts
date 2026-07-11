/**
 * Apps-inventory scheduler — drives the deploy loop's apply-then-observe passes
 * so the cluster tracks the declared CRs in git and the `apps` table tracks the
 * live cluster + GitHub releases, without manual kubectl or seeding.
 *
 *   - apply (`applyDeclaredCRs`): git → CR. Pushes the reconcilable declared
 *     `Service` CRs from `hanzoai/universe` into the cluster (the native
 *     replacement for the `gitops-reconcile` cron). Incremental — steady state
 *     is one directory-listing call and zero applies. Runs FIRST each tick.
 *   - inventory (`syncInventory`): declared (operator CR) + running (Deployment)
 *     + health, read from the cluster. Cheap and read-mostly, so it ticks fast
 *     (default 60s). Runs AFTER apply, so it observes what apply just declared.
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

let started = false;
let ticking = false;
let releaseTicking = false;

/**
 * Run one git→CR apply pass, logging the outcome; never throws. Gated by the ONE
 * `PLATFORM_CRS_APPLY` flag. A `source.list()` failure (GitHub unreachable) is
 * logged and swallowed here so it can never skip the observe pass that follows.
 */
export async function applyDeclaredOnce(): Promise<void> {
	if (!CRS_APPLY_ENABLED) return;
	try {
		const s = await applyDeclaredCRs();
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
	}
}

/** Run one apply-then-observe pass, logging the outcome; never throws. */
export async function runInventoryOnce(): Promise<void> {
	if (ticking) return; // skip if the previous tick is still in flight
	ticking = true;
	try {
		// apply (git → CR) FIRST, then observe (CR/Deployment → drift), so the
		// inventory pass reflects what apply just declared. Decomplected: apply and
		// observe are separate functions composed here, sharing no state.
		await applyDeclaredOnce();
		const results = await syncInventory();
		const total = results.reduce((n, r) => n + r.upserted, 0);
		console.log(
			`[apps-inventory] synced ${total} apps across ${results.length} cluster(s): ` +
				results.map((r) => `${r.cluster}=${r.upserted}`).join(", "),
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
		const { repos, updated } = await syncReleases();
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
		`[apps-inventory] scheduler starting (apply=${CRS_APPLY_ENABLED ? "on" : "off"}, ` +
			`inventory every ${INTERVAL_MS}ms, releases every ${RELEASE_INTERVAL_MS}ms)`,
	);

	// Inventory first so the apps table is populated before releases are read.
	void runInventoryOnce();
	const handle = setInterval(() => void runInventoryOnce(), INTERVAL_MS);
	if (typeof handle.unref === "function") handle.unref();

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
