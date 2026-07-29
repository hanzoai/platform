import type { DriftSeverity } from "./apps-drift";

/**
 * The fleet counted up — one implementation, used by both the `/v1/apps`
 * response header and the board's own header.
 *
 * It lives here, apart from the read API, for one reason: the board filters by
 * org in the browser, so it must be able to recount what is ON SCREEN. If it
 * could only read the API's totals, a filtered table would sit under a header
 * describing the whole fleet — a status surface disagreeing with the thing it
 * describes. Sharing the counter is what makes that impossible.
 *
 * PURE: no IO, no db import, so a client bundle can carry it.
 */

/** Sync vocabulary plus the honest fourth case: nothing manages this app. */
export type SyncCount = "synced" | "drifted" | "unknown" | "unmanaged";

export interface AppsSummary {
	total: number;
	byDrift: Record<DriftSeverity, number>;
	bySync: Record<SyncCount, number>;
	/**
	 * Apps per org, DERIVED from the rows — so a new org appears on the board the
	 * moment it has an app, and nothing has to be added to a list somewhere.
	 */
	byOrg: Record<string, number>;
}

/** Exactly what the counter reads. Any row shape carrying these can be counted. */
export interface Countable {
	org: string;
	syncStatus: SyncCount | null;
	drift: { severity: DriftSeverity };
}

/** Roll a list of rows up to the header counts. */
export function summarize(rows: Countable[]): AppsSummary {
	const byDrift: Record<DriftSeverity, number> = { ok: 0, yellow: 0, red: 0 };
	const bySync: Record<SyncCount, number> = {
		synced: 0,
		drifted: 0,
		unknown: 0,
		unmanaged: 0,
	};
	const byOrg: Record<string, number> = {};
	for (const r of rows) {
		byDrift[r.drift.severity] += 1;
		bySync[r.syncStatus ?? "unmanaged"] += 1;
		byOrg[r.org] = (byOrg[r.org] ?? 0) + 1;
	}
	return { total: rows.length, byDrift, bySync, byOrg };
}
