/**
 * Read surface for the apps-lifecycle table — backs `/v1/apps` (PR 3 of
 * `docs/APPS_LIFECYCLE.md`).
 *
 * The four cron readers (PR 2) own writing the observed columns; this module
 * only READS them and projects each row into a stable DTO that pairs the raw
 * observed tags with the computed drift verdict (`computeDrift`, the single
 * drift authority). The console drift view at `platform.hanzo.ai/apps` and any
 * external caller consume this exact shape.
 *
 * Filtering mirrors the drift-view controls in the contract (org / env /
 * health), plus a `drift` filter so a caller can ask only for rows that are
 * actually drifting. Org scoping follows the contract's X-Org-Id convention:
 * the handler resolves the org filter from the `X-Org-Id` header or `?org=`
 * query and passes it here. RBAC is deliberately deferred (contract: "New
 * permissions = follow-up").
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "@hanzo/platform/db";
import {
	type App,
	appEnvValues,
	appHealthValues,
	apps,
	computeDrift,
	type Drift,
	type DriftSeverity,
} from "@hanzo/platform/db/schema";

// Enum vocabularies derive from the single canonical source — the
// `appEnvValues` / `appHealthValues` tuples in `db/schema/apps`. They are the
// same `as const` tuples the SQLite column `{ enum: … }` and the Zod schemas
// are built from, so these types cannot drift out of sync with the DB enum.
// Don't hand-retype them.
/** Deployment env vocabulary (`"dev" | "test" | "main"`). */
export type AppEnv = (typeof appEnvValues)[number];
/** Aggregate health vocabulary (`"green" | "yellow" | "red"`). */
export type AppHealth = (typeof appHealthValues)[number];

/** Filters accepted by the list endpoint (all optional, all narrowing). */
export interface AppsQuery {
	org?: string;
	env?: AppEnv;
	health?: AppHealth;
	/** When true, return only rows whose drift severity is not `ok`. */
	drift?: boolean;
}

/**
 * The wire shape for one app row: the full observed row plus the derived drift
 * verdict. `declaredTag` / `runningTag` / `latestTag` are surfaced verbatim so
 * the consumer can render exactly what the readers observed.
 */
export interface AppView {
	id: string;
	org: string;
	app: string;
	env: AppEnv;
	repo: string;
	registry: string;
	declaredTag: string | null;
	runningTag: string | null;
	latestTag: string | null;
	releaseUrl: string | null;
	releaseAssets: number;
	health: AppHealth | null;
	cluster: string | null;
	namespace: string | null;
	/** Public hostnames the workload CR publishes; empty for internal services. */
	hosts: string[];
	lastObserved: string | null;
	updatedAt: string;
	/** Derived per `docs/APPS_LIFECYCLE.md` — never stored, always computed. */
	drift: Drift;
}

/** ISO-8601 or null for the nullable timestamp columns. */
const iso = (d: Date | string | null): string | null =>
	d == null ? null : d instanceof Date ? d.toISOString() : d;

/** ISO-8601 for NOT NULL timestamp columns (e.g. `updatedAt`). */
const isoNN = (d: Date | string): string =>
	d instanceof Date ? d.toISOString() : d;

/** Project a raw `apps` row into the wire DTO, attaching the drift verdict. */
export const toAppView = (row: App): AppView => ({
	id: row.id,
	org: row.org,
	app: row.app,
	env: row.env as AppEnv,
	repo: row.repo,
	registry: row.registry,
	declaredTag: row.declaredTag,
	runningTag: row.runningTag,
	latestTag: row.latestTag,
	releaseUrl: row.releaseUrl,
	releaseAssets: row.releaseAssets,
	health: (row.health as AppHealth | null) ?? null,
	cluster: row.cluster,
	namespace: row.namespace,
	// JSON column: normalize null / legacy non-array values to [] so every
	// consumer can map over it without a guard.
	hosts: Array.isArray(row.hosts) ? row.hosts : [],
	lastObserved: iso(row.lastObserved),
	// `updatedAt` is NOT NULL (column has `.notNull().defaultNow()`), so it is
	// always present — format it directly, no nullable fallback.
	updatedAt: isoNN(row.updatedAt),
	drift: computeDrift(row),
});

/** Rolled-up counts for the list response header. */
export interface AppsSummary {
	total: number;
	byDrift: Record<DriftSeverity, number>;
}

/** The list response envelope: ordered rows + a drift summary. */
export interface AppsListResponse {
	apps: AppView[];
	summary: AppsSummary;
}

/**
 * List apps, filtered and ordered deterministically (org, app, env). Health and
 * env are filtered in SQL (indexed enum columns); the `drift` filter is applied
 * after projection because drift is derived, not stored.
 */
export async function listApps(query: AppsQuery): Promise<AppsListResponse> {
	const conditions = [
		query.org ? eq(apps.org, query.org) : undefined,
		query.env ? eq(apps.env, query.env) : undefined,
		query.health ? eq(apps.health, query.health) : undefined,
	].filter((c): c is NonNullable<typeof c> => c !== undefined);

	const rows = await db
		.select()
		.from(apps)
		.where(conditions.length ? and(...conditions) : undefined)
		.orderBy(asc(apps.org), asc(apps.app), asc(apps.env));

	let views = rows.map(toAppView);
	if (query.drift) {
		views = views.filter((v) => v.drift.severity !== "ok");
	}

	const byDrift: Record<DriftSeverity, number> = { ok: 0, yellow: 0, red: 0 };
	for (const v of views) byDrift[v.drift.severity] += 1;

	return { apps: views, summary: { total: views.length, byDrift } };
}

/**
 * Fetch one app by its `<org>/<app>/<env>` id, scoped to `org` when provided
 * (so a tenant cannot read another tenant's row by guessing the id). Returns
 * null when not found / out of scope.
 */
export async function getApp(
	id: string,
	org?: string,
): Promise<AppView | null> {
	const conditions = [eq(apps.id, id)];
	if (org) conditions.push(eq(apps.org, org));

	const row = await db
		.select()
		.from(apps)
		.where(and(...conditions))
		.limit(1);

	return row[0] ? toAppView(row[0]) : null;
}
