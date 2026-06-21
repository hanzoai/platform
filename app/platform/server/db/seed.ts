/**
 * Seed the apps-lifecycle table (PR 1 of docs/APPS_LIFECYCLE.md).
 *
 * Inserts one row per managed service per env. Production (`env = "main"`) is
 * seeded for every service from the universe operator CRs at
 * `infra/k8s/operator/crs/*-v1.yaml`, which are the declared-state source of
 * truth. `declaredTag` is recorded VERBATIM — a floating reference (e.g. kms's
 * `multi-issuer`) is stored as-is so the drift checker (PR 2) can flag it; this
 * table observes reality, it never normalizes.
 *
 * `runningTag` / `latestTag` / `health` / `lastObserved` are intentionally left
 * NULL here: those are written by the four cron readers in PR 2
 * (read_latest_tag, read_declared_tag, read_running_tag, read_release_meta).
 *
 * Idempotent: re-running upserts by the `<org>/<app>/<env>` primary key and
 * never clobbers reader-owned observed columns.
 *
 * Run: `pnpm --filter @hanzo/platform-app db:seed`
 */

import { dbUrl, ensureSqliteDir, resolveSqlitePath } from "@hanzo/platform/db";
import { apps, type NewApp } from "@hanzo/platform/db/schema";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

/** Managed services. `declaredTag` is the verbatim tag from the service's
 *  operator CR; `null` means no CR declares it yet (control plane / pending
 *  canonical image). */
type Service = {
	app: string;
	repo: string;
	declaredTag: string | null;
};

const ORG = "hanzoai";
const CLUSTER = "hanzo-k8s";
const NAMESPACE = "hanzo";
const ENVS = ["main"] as const;

const SERVICES: Service[] = [
	{ app: "cloud", repo: "hanzoai/cloud", declaredTag: "1.785.0" },
	{ app: "chat", repo: "hanzoai/chat", declaredTag: "0.7.9" },
	{ app: "gateway", repo: "hanzoai/gateway", declaredTag: "v2.14.7" },
	{ app: "iam", repo: "hanzoai/iam", declaredTag: "1.19.5" },
	// kms CR pins a floating `multi-issuer` tag — recorded verbatim so PR 2's
	// drift checker flags it (policy: declared_tag must match ^v\d+\.\d+\.\d+$).
	{ app: "kms", repo: "hanzoai/kms", declaredTag: "multi-issuer" },
	{ app: "commerce", repo: "hanzoai/commerce", declaredTag: "1.42.25" },
	{ app: "console", repo: "hanzoai/console", declaredTag: "3.156.7" },
	{ app: "app", repo: "hanzoai/app", declaredTag: "0.0.1" },
	// id: canonical login frontend is hanzoai/id; the live CR still references
	// the older hanzoai/login image, so nothing declares hanzoai/id yet → null.
	{ app: "id", repo: "hanzoai/id", declaredTag: null },
	// platform: the control plane itself — no operator CR declares it.
	{ app: "platform", repo: "hanzoai/platform", declaredTag: null },
	{ app: "paas", repo: "hanzoai/paas", declaredTag: "v4.1.0" },
	{ app: "ingress", repo: "hanzoai/ingress", declaredTag: "1.7.41" },
	{ app: "s3", repo: "hanzoai/s3", declaredTag: "1.0.1" },
];

const rows: NewApp[] = SERVICES.flatMap((svc) =>
	ENVS.map((env) => ({
		id: `${ORG}/${svc.app}/${env}`,
		org: ORG,
		app: svc.app,
		env,
		repo: svc.repo,
		registry: `ghcr.io/${svc.repo}`,
		declaredTag: svc.declaredTag,
		cluster: CLUSTER,
		namespace: NAMESPACE,
	})),
);

const seed = (): void => {
	const dbPath = resolveSqlitePath(dbUrl);
	ensureSqliteDir(dbPath);
	const sqlite = new BetterSqlite3(dbPath);
	sqlite.pragma("foreign_keys = ON");
	const db = drizzle(sqlite);
	try {
		const upsert = sqlite.transaction(() => {
			for (const row of rows) {
				db.insert(apps)
					.values(row)
					.onConflictDoUpdate({
						target: apps.id,
						// Only the declared/topology facts this seed owns — never the
						// reader-owned observed columns (runningTag/latestTag/health/...).
						set: {
							org: row.org,
							app: row.app,
							env: row.env,
							repo: row.repo,
							registry: row.registry,
							declaredTag: row.declaredTag ?? null,
							cluster: row.cluster ?? null,
							namespace: row.namespace ?? null,
							updatedAt: new Date(),
						},
					})
					.run();
			}
		});
		upsert();
		console.log(`Seeded ${rows.length} apps rows`);
	} catch (error) {
		console.error("Error seeding apps", error);
		process.exitCode = 1;
	} finally {
		sqlite.close();
	}
};

seed();
