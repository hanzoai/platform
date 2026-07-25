import { relations } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organization } from "./account";

/**
 * apps — the apps-lifecycle source of truth.
 *
 * Contract: `docs/APPS_LIFECYCLE.md`. One row per (org, app, env). Records the
 * three tags that the drift view at `platform.hanzo.ai/apps` compares:
 *
 *   - `declaredTag`  — what SHOULD run (scraped from the universe operator CRs)
 *   - `runningTag`   — what ACTUALLY runs (observed from the cluster)
 *   - `latestTag`    — the newest released image (observed from GHCR/GAR)
 *
 * Drift is any deviation between the three (or a non-semver `declaredTag`, or a
 * GH Release with no assets). Four independent cron readers populate the
 * observed columns (PR 2): `read_latest_tag`, `read_declared_tag`,
 * `read_running_tag`, `read_release_meta`. This table only records observed
 * reality — it never normalizes (a floating `declaredTag` is stored verbatim so
 * the drift checker can flag it).
 *
 * The id is the human-stable `<org>/<app>/<env>` key (e.g. `hanzoai/iam/main`);
 * `(org, app, env)` is additionally unique so a reader can upsert by tuple.
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

export const apps = sqliteTable(
	"apps",
	{
		/** `<org>/<app>/<env>`, e.g. `hanzoai/iam/main`. */
		id: text("id").notNull().primaryKey(),
		/** GitHub org / image namespace, e.g. `hanzoai`. */
		org: text("org").notNull(),
		/** App / service name, e.g. `iam`. */
		app: text("app").notNull(),
		env: text("env", { enum: appEnvValues }).notNull(),
		/** `owner/repo`, e.g. `hanzoai/iam`. */
		repo: text("repo").notNull(),
		/** Image registry path, e.g. `ghcr.io/hanzoai/iam`. */
		registry: text("registry").notNull(),
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
		/** When the readers last observed this row. */
		lastObserved: integer("last_observed", { mode: "timestamp_ms" }),
		/** Target cluster, e.g. `hanzo-k8s`. */
		cluster: text("cluster"),
		/** Target namespace, e.g. `hanzo`. */
		namespace: text("namespace"),
		/**
		 * Public hostnames the operator CR publishes (`spec.ingress.hosts`), e.g.
		 * `["analytics.hanzo.ai"]`. This is what turns the board from a list of
		 * names into a directory you can click through to the running service.
		 * Observed like every other column here — never hand-maintained. Null when
		 * the CR declares no ingress (internal-only workloads).
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
	},
	(table) => ({
		appsUnique: uniqueIndex("apps_unique").on(table.org, table.app, table.env),
	}),
);

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
	repo: z.string().min(1),
	registry: z.string().min(1),
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
