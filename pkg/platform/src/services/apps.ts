import { db } from "@hanzo/platform/db";
import type { App } from "@hanzo/platform/db/schema";
import { apps } from "@hanzo/platform/db/schema";
import { and, asc, eq } from "drizzle-orm";

/**
 * apps service — the single read path for the apps-lifecycle drift view.
 *
 * Contract: `docs/APPS_LIFECYCLE.md`. Both transports that expose the apps
 * table — the tRPC `apps` router (the in-app `platform.hanzo.ai/apps` page) and
 * the REST `/v1/apps` endpoint — call `findApps` here. One query, two
 * transports: drift is derived in exactly one place so the page and the API can
 * never disagree (the bug class this whole contract eliminates).
 *
 * This module only READS. The four cron readers (PR 2) own the observed columns
 * (`runningTag` / `latestTag` / `health` / `lastObserved`); the seed owns the
 * declared/topology columns. Nothing here mutates the table.
 */

/** A published artifact tag is semver-only: `vMAJOR.MINOR.PATCH`. Anything else
 *  (`:main`, `:latest`, `multi-issuer`, `sha-…`) is a floating reference and a
 *  policy violation at the reconcile boundary. Mirrors the regex the operator
 *  reconciler enforces in `docs/APPS_LIFECYCLE.md` §4. */
export const SEMVER_TAG = /^v\d+\.\d+\.\d+$/;

export const isSemverTag = (tag: string | null | undefined): boolean =>
	!!tag && SEMVER_TAG.test(tag);

/**
 * Drift kinds, in descending severity. The first one that applies wins — this
 * is the single rule the drift column on `platform.hanzo.ai/apps` renders.
 *
 *   - `floating`   (red)    declared or running tag is not semver.
 *   - `no-release` (red)    declared tag has no GH Release, or the Release
 *                           shipped with zero assets (the iam v1.15.0 bug).
 *   - `un-rolled`  (yellow) running tag ≠ declared tag (reconcile pending).
 *   - `stale`      (yellow) declared tag is behind the latest released tag.
 *   - `unknown`    (blank)  a reader has not observed enough to decide yet.
 *   - `none`       (green)  declared == running == latest, release has assets.
 */
export type DriftKind =
	| "none"
	| "stale"
	| "un-rolled"
	| "floating"
	| "no-release"
	| "unknown";

export type DriftLevel = "ok" | "warn" | "error" | "unknown";

export type Drift = {
	kind: DriftKind;
	level: DriftLevel;
	/** One-line human summary, e.g. `1 version behind` / `running ≠ declared`. */
	reason: string;
};

/** An apps row enriched with the derived drift verdict. */
export type AppWithDrift = App & { drift: Drift };

const DRIFT_LEVEL: Record<DriftKind, DriftLevel> = {
	none: "ok",
	stale: "warn",
	"un-rolled": "warn",
	floating: "error",
	"no-release": "error",
	unknown: "unknown",
};

const drift = (kind: DriftKind, reason: string): Drift => ({
	kind,
	level: DRIFT_LEVEL[kind],
	reason,
});

/**
 * Derive the drift verdict for one apps row from its observed columns.
 *
 * Pure: no I/O, deterministic in its input. The severity order below is the
 * contract — red (policy/release violations) outranks yellow (rollout lag),
 * which outranks green. Missing observations degrade to `unknown` rather than
 * silently reading as healthy (the whole point: silent drift is the bug).
 */
export const computeDrift = (app: App): Drift => {
	const { declaredTag, runningTag, latestTag, releaseUrl, releaseAssets } = app;

	// Red — floating reference anywhere in the live path. Stored verbatim by the
	// readers/seed so it can be flagged here (e.g. kms's `multi-issuer`).
	if (declaredTag && !isSemverTag(declaredTag)) {
		return drift("floating", `declared tag "${declaredTag}" is not semver`);
	}
	if (runningTag && !isSemverTag(runningTag)) {
		return drift("floating", `running tag "${runningTag}" is not semver`);
	}

	// Red — declared a semver tag, but its GH Release is missing or has no
	// assets (the missing-binaries class the verify step in PR 4 closes).
	if (declaredTag) {
		if (!releaseUrl) {
			return drift("no-release", `no GH Release for ${declaredTag}`);
		}
		if (releaseAssets <= 0) {
			return drift("no-release", `GH Release ${declaredTag} has 0 assets`);
		}
	}

	// Below here a tag may simply not be observed yet. Don't pretend it's green.
	if (!declaredTag) {
		return drift("unknown", "no declared tag");
	}
	if (!runningTag) {
		return drift("unknown", "running tag not observed");
	}

	// Yellow — declared, released-with-assets, but the cluster hasn't rolled to
	// it. Reconcile is pending (or stuck).
	if (runningTag !== declaredTag) {
		return drift(
			"un-rolled",
			`running ${runningTag} ≠ declared ${declaredTag}`,
		);
	}

	// Yellow — running matches declared, but a newer tag has been released and
	// the declaration hasn't been bumped to it.
	if (latestTag && declaredTag !== latestTag) {
		return drift("stale", `${latestTag} released, declared ${declaredTag}`);
	}

	// Latest unknown but declared == running and release is good enough to ship.
	if (!latestTag) {
		return drift("unknown", "latest tag not observed");
	}

	return drift("none", "in sync");
};

export type FindAppsFilter = {
	org?: string;
	env?: "dev" | "test" | "main";
	health?: "green" | "yellow" | "red";
};

/**
 * Read the apps-lifecycle rows for a tenant, enriched with the derived drift
 * verdict. The optional filter narrows by org / env / health. Rows are ordered
 * by `(org, app, env)` so the drift view is stable across reloads.
 *
 * @param organizationId scopes to the calling tenant's rows (plus the shared
 *   control-plane rows whose `organizationId` is null — these are seeded for the
 *   managed services and belong to no single tenant).
 */
export const findApps = async (
	organizationId: string | null | undefined,
	filter: FindAppsFilter = {},
): Promise<AppWithDrift[]> => {
	const where = and(
		filter.org ? eq(apps.org, filter.org) : undefined,
		filter.env ? eq(apps.env, filter.env) : undefined,
		filter.health ? eq(apps.health, filter.health) : undefined,
	);

	const rows = await db.query.apps.findMany({
		where,
		orderBy: [asc(apps.org), asc(apps.app), asc(apps.env)],
	});

	// Tenant scoping is applied after the DB read so the shared null-tenant
	// control-plane rows are always visible alongside the caller's own rows.
	const scoped = organizationId
		? rows.filter(
				(r) => r.organizationId === organizationId || r.organizationId === null,
			)
		: rows;

	return scoped.map((app) => ({ ...app, drift: computeDrift(app) }));
};
