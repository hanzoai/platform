/**
 * Apps-inventory scheduler — drives `syncInventory` on boot and on a fixed
 * interval so the `apps` table tracks the live cluster without manual seeding.
 *
 * Mirrors the billing-job scheduler pattern (`billing/billing-job.ts`):
 * idempotent start (a module-level guard makes a second call a no-op), a leading
 * run, then `setInterval`. The sync is read-mostly (lists CRs + Deployments,
 * writes only platform's own SQLite), so running it every minute is cheap and
 * cannot perturb the control plane.
 *
 * Started from the custom server (`server/server.ts`) when the platform runs
 * in-cluster. Failures are logged and swallowed — a transient cluster blip must
 * never crash the server or stop future ticks.
 */

import { syncInventory } from "./inventory";

/** How often to reconcile the apps table from the cluster (ms). */
const INTERVAL_MS = Number.parseInt(
	process.env.APPS_INVENTORY_INTERVAL_MS || "60000",
	10,
);

let started = false;
let ticking = false;

/** Run one sync pass, logging the outcome; never throws. */
export async function runInventoryOnce(): Promise<void> {
	if (ticking) return; // skip if the previous tick is still in flight
	ticking = true;
	try {
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

/** Start the scheduler (idempotent): leading run + interval. */
export function startInventoryScheduler(): void {
	if (started) return;
	started = true;
	console.log(
		`[apps-inventory] scheduler starting (every ${INTERVAL_MS}ms)`,
	);
	void runInventoryOnce();
	const handle = setInterval(() => void runInventoryOnce(), INTERVAL_MS);
	// Don't keep the event loop alive solely for this timer.
	if (typeof handle.unref === "function") handle.unref();
}
