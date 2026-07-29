import { relations } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organization } from "./account";

/**
 * apps — the fleet the control plane observes: every app of every org, on every
 * cluster, in one table.
 *
 * Contract: `docs/APPS_LIFECYCLE.md`. Records the three tags the board at
 * `platform.hanzo.ai/apps` compares, plus what the deployer says about them:
 *
 *   - `declaredTag`  — what SHOULD run (the workload CR's declared image)
 *   - `runningTag`   — what ACTUALLY runs (observed from the live workload)
 *   - `latestTag`    — the newest released image (observed from GHCR/GH releases)
 *   - `syncStatus`   — whether the live objects still match git (from CD)
 *
 * Every column is an OBSERVATION. A value the readers cannot see is null and
 * renders "unknown" — never a placeholder, never a guess. Nothing is normalized
 * either: a floating `declaredTag` is stored verbatim so the drift checker can
 * flag it.
 *
 * IDENTITY: `<cluster>/<namespace>/<app>` — where the thing runs. That tuple is
 * unique by Kubernetes construction, so the primary key carries the whole
 * identity and there is no second uniqueness mechanism. (`<org>/<app>/<env>`
 * was unique only while the estate was one cluster with one namespace per env;
 * across the fleet the release `cloud` runs in three namespaces at once.)
 */

/**
 * Aggregate health rolled up from probes + drift. SQLite has no native enum;
 * the value set is declared once here and enforced by the column's `enum`
 * constraint (drizzle-zod) and the migration's CHECK constraint.
 */
export const appHealthValues = ["green", "yellow", "red"] as const;

/**
 * Deployment environment. Mirrors the lifecycle vocabulary in
 * `docs/APPS_LIFECYCLE.md` — `main` is production. (Distinct from the legacy
 * Coolify free-text `env` on `project`; the apps table is semver-governed.)
 */
export const appEnvValues = ["dev", "test", "main"] as const;

/**
 * What the deployer says about the gap between git and the live objects, in OUR
 * vocabulary (CD's `Synced`/`OutOfSync`/`Unknown` are mapped at the boundary, so
 * one word means one thing everywhere downstream). Null = no deployer manages
 * this app, which is itself a finding.
 */
export const appSyncValues = ["synced", "drifted", "unknown"] as const;

export const apps = sqliteTable("apps", {
	/** `<cluster>/<namespace>/<app>`, e.g. `hanzo-k8s/hanzo/iam`. */
	id: text("id").notNull().primaryKey(),
	/** Owning brand org, e.g. `hanzo`, `lux`, `zoo`. */
	org: text("org").notNull(),
	/** App / service name, e.g. `iam`. */
	app: text("app").notNull(),
	env: text("env", { enum: appEnvValues }).notNull(),
	/** `owner/repo`, e.g. `hanzoai/iam`. Null when no image was observed. */
	repo: text("repo"),
	/** Image registry path, e.g. `ghcr.io/hanzoai/iam`. Null when unobserved. */
	registry: text("registry"),
	/** Declared tag from the universe operator CR (e.g. `v1.15.0`). */
	declaredTag: text("declared_tag"),
	/** Observed running tag from the cluster (e.g. `v1.14.29`). */
	runningTag: text("running_tag"),
	/** Newest released tag observed from GHCR/GAR (e.g. `v1.15.0`). */
	latestTag: text("latest_tag"),
	/** GH Release URL for `declaredTag`. */
	releaseUrl: text("release_url"),
	/** Asset count on the GH Release (0 = release shipped with no binaries). */
	releaseAssets: integer("release_assets").notNull().default(0),
	health: text("health", { enum: appHealthValues }),
	/**
	 * Whether the deployer still finds the live objects matching git. Only CD
	 * can answer this — it is the one party that renders the manifest and
	 * diffs it — so it is the one column CD owns for every row on the board.
	 */
	syncStatus: text("sync_status", { enum: appSyncValues }),
	/** The git revision CD last reconciled this app to (full sha), if known. */
	syncRevision: text("sync_revision"),
	/** When the readers last observed this row. */
	lastObserved: integer("last_observed", { mode: "timestamp_ms" }),
	/** Target cluster, e.g. `hanzo-k8s`. */
	cluster: text("cluster"),
	/** Target namespace, e.g. `hanzo`. */
	namespace: text("namespace"),
	/**
	 * Public hostnames the workload CR publishes (`spec.ingress.hosts`), e.g.
	 * `["analytics.hanzo.ai"]`. This is what turns the board from a list of
	 * names into a directory you can click through to the running service.
	 * Observed like every other column here — never hand-maintained. Null when
	 * the CR declares no ingress, and on clusters platform cannot read
	 * directly (the deployer reports images and sync, not hostnames).
	 */
	hosts: text("hosts", { mode: "json" }).$type<string[]>(),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
	/** Owning org tenant (multi-tenant installs run their own apps table). */
	organizationId: text("organizationId").references(() => organization.id, {
		onDelete: "cascade",
	}),
});

export const appsRelations = relations(apps, ({ one }) => ({
	organization: one(organization, {
		fields: [apps.organizationId],
		references: [organization.id],
	}),
}));

const createSchema = createInsertSchema(apps, {
	id: z.string().min(1),
	org: z.string().min(1),
	app: z.string().min(1),
});

export const apiUpsertApp = createSchema.pick({
	id: true,
	org: true,
	app: true,
	env: true,
	repo: true,
	registry: true,
	declaredTag: true,
	runningTag: true,
	latestTag: true,
	releaseUrl: true,
	releaseAssets: true,
	health: true,
	syncStatus: true,
	syncRevision: true,
	cluster: true,
	namespace: true,
	hosts: true,
});

export const apiFindOneApp = z.object({
	id: z.string().min(1),
});

export const apiListApps = z.object({
	org: z.string().optional(),
	env: z.enum(appEnvValues).optional(),
	health: z.enum(appHealthValues).optional(),
});

export type App = typeof apps.$inferSelect;
export type NewApp = typeof apps.$inferInsert;
