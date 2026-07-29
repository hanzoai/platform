import type { App } from "./apps";

/**
 * apps-drift — the single source of truth for the drift semantics in
 * `docs/APPS_LIFECYCLE.md`.
 *
 * "Drift is loud" (constraint 5): every deviation between the three observed
 * tags — `declaredTag` (what SHOULD run), `runningTag` (what ACTUALLY runs),
 * `latestTag` (newest released) — plus release-artifact integrity, is reduced
 * here to a flat list of typed flags and a single rolled-up severity. The
 * `/v1/apps` API, the `platform.hanzo.ai/apps` page, and the PR-5 operator
 * reconciler all read drift through THIS module so the rules can never diverge
 * (one way to compute drift, period).
 *
 * This module is pure: it derives flags from an already-observed `apps` row and
 * never performs IO. The cron readers (PR 2) own writing the observed columns;
 * the drift checker only interprets them.
 */

/**
 * Semver-only policy from constraint 1: every declared/running tag MUST be
 * exactly `vMAJOR.MINOR.PATCH`. Anything else (`:main`, `:latest`, `:dev`,
 * `:edge`, `sha-…`, `multi-issuer`, …) is a floating reference. Mirrors the
 * `^v\d+\.\d+\.\d+$` gate the reconciler enforces at the patch boundary.
 */
const SEMVER_TAG = /^v\d+\.\d+\.\d+$/;

/**
 * Exactly the observed columns drift is derived from — named once so every
 * caller (API, board, reconciler) proves it passes the same evidence.
 */
export type DriftInput = Pick<
	App,
	| "declaredTag"
	| "runningTag"
	| "latestTag"
	| "releaseUrl"
	| "releaseAssets"
	| "syncStatus"
>;

/** True when `tag` is a strict `vX.Y.Z` semver tag. */
export const isSemverTag = (tag: string | null | undefined): boolean =>
	typeof tag === "string" && SEMVER_TAG.test(tag);

/**
 * The kinds of drift enumerated by `docs/APPS_LIFECYCLE.md` (drift-state row
 * + the drift view legend). Each value is independent — a row can carry
 * several at once (e.g. a floating running tag with a zero-asset release).
 */
export type DriftKind =
	/** declared ≠ latest: a newer release exists but is not declared. (yellow) */
	| "stale"
	/** running ≠ declared: the cluster has not rolled to the declared tag. (yellow) */
	| "un-rolled"
	/** declaredTag is not strict semver — reconciler would refuse it. (red) */
	| "floating-declared"
	/** runningTag is not strict semver — policy violation on the cluster. (red) */
	| "floating-running"
	/** no GH Release found for the declared tag. (red) */
	| "no-release"
	/** GH Release exists but shipped 0 assets (e.g. iam v1.15.0). (red) */
	| "zero-assets"
	/** the deployer reports the live objects no longer match git. (yellow) */
	| "unsynced";

/** Aggregate drift severity. `ok` = no flags; otherwise the max over flags. */
export type DriftSeverity = "ok" | "yellow" | "red";

/** A single drift finding: its kind, severity, and a human-readable reason. */
export interface DriftFlag {
	kind: DriftKind;
	severity: Exclude<DriftSeverity, "ok">;
	message: string;
}

/** Per-kind severity. Stale/un-rolled are warnings; the rest are hard drift. */
const SEVERITY: Record<DriftKind, Exclude<DriftSeverity, "ok">> = {
	stale: "yellow",
	"un-rolled": "yellow",
	"floating-declared": "red",
	"floating-running": "red",
	"no-release": "red",
	"zero-assets": "red",
	unsynced: "yellow",
};

/**
 * The drift verdict for one `apps` row: the ordered flags plus the rolled-up
 * severity (`red` if any red flag, else `yellow` if any, else `ok`).
 */
export interface Drift {
	severity: DriftSeverity;
	flags: DriftFlag[];
}

const flag = (kind: DriftKind, message: string): DriftFlag => ({
	kind,
	severity: SEVERITY[kind],
	message,
});

/**
 * Compute the drift flags for a single observed `apps` row, exactly per
 * `docs/APPS_LIFECYCLE.md`.
 *
 * Detection rules (each independent; a row may trip several):
 *
 *  - **floating-declared** — `declaredTag` is set but not `vX.Y.Z`. The
 *    reconciler refuses non-semver declarations, so this is hard drift. (When
 *    the declaration itself is floating, comparing it against `latestTag` for
 *    "stale" is meaningless, so `stale` is suppressed in that case.)
 *  - **floating-running** — `runningTag` is set but not `vX.Y.Z`: the cluster
 *    is running a floating image (the `:main`-regrew class). Hard drift.
 *  - **stale** — `declaredTag` and `latestTag` are both known semver and
 *    differ: a newer release exists that is not yet declared.
 *  - **un-rolled** — `declaredTag` and `runningTag` are both known and differ:
 *    the declaration has not reached the cluster yet.
 *  - **no-release** — a `declaredTag` exists but no GH Release was found for it
 *    (`releaseUrl` empty). Can't have shipped verified artifacts.
 *  - **zero-assets** — a GH Release exists (`releaseUrl` set) but
 *    `releaseAssets === 0` (the v1.15.0-with-0-binaries class).
 *
 * Tags are compared verbatim (the readers store reality un-normalized); no
 * ordering is assumed beyond equality, matching the contract ("records observed
 * reality — it never normalizes").
 */
export const computeDriftFlags = (app: DriftInput): DriftFlag[] => {
	const {
		declaredTag,
		runningTag,
		latestTag,
		releaseUrl,
		releaseAssets,
		syncStatus,
	} = app;
	const flags: DriftFlag[] = [];

	const declaredFloating = declaredTag != null && !isSemverTag(declaredTag);
	const runningFloating = runningTag != null && !isSemverTag(runningTag);

	if (declaredFloating) {
		flags.push(
			flag(
				"floating-declared",
				`declared tag "${declaredTag}" is not semver (vX.Y.Z); the reconciler will refuse it`,
			),
		);
	}

	if (runningFloating) {
		flags.push(
			flag(
				"floating-running",
				`running tag "${runningTag}" is a floating reference, not semver`,
			),
		);
	}

	// "stale" only makes sense for a semver declaration: declared ≠ latest.
	if (
		!declaredFloating &&
		declaredTag != null &&
		latestTag != null &&
		declaredTag !== latestTag
	) {
		flags.push(
			flag(
				"stale",
				`declared ${declaredTag} is behind latest ${latestTag}`,
			),
		);
	}

	// "un-rolled": running ≠ declared (only flag the gap once running is known
	// and not already flagged as floating, to avoid double-counting).
	if (
		!runningFloating &&
		declaredTag != null &&
		runningTag != null &&
		runningTag !== declaredTag
	) {
		flags.push(
			flag(
				"un-rolled",
				`running ${runningTag} has not rolled to declared ${declaredTag}`,
			),
		);
	}

	// The deployer's own verdict. It answers a question no tag comparison can:
	// the live objects have moved away from git (or were never reconciled), so
	// the declaration on disk is not what the cluster is honouring. `unknown` is
	// deliberately NOT flagged — "the deployer could not tell" is a gap in
	// evidence, and inventing drift from missing evidence is the failure mode
	// this board exists to prevent.
	if (syncStatus === "drifted") {
		flags.push(
			flag("unsynced", "live objects no longer match git; CD reports OutOfSync"),
		);
	}

	// Release-artifact integrity is keyed off the declared tag.
	if (declaredTag != null) {
		if (!releaseUrl) {
			flags.push(
				flag("no-release", `no GH Release found for declared tag ${declaredTag}`),
			);
		} else if ((releaseAssets ?? 0) === 0) {
			flags.push(
				flag(
					"zero-assets",
					`GH Release for ${declaredTag} shipped 0 assets`,
				),
			);
		}
	}

	return flags;
};

/** Roll a list of flags up to a single severity (`red` > `yellow` > `ok`). */
export const driftSeverity = (flags: DriftFlag[]): DriftSeverity => {
	if (flags.some((f) => f.severity === "red")) return "red";
	if (flags.some((f) => f.severity === "yellow")) return "yellow";
	return "ok";
};

/** Full drift verdict (flags + rolled-up severity) for one `apps` row. */
export const computeDrift = (app: DriftInput): Drift => {
	const flags = computeDriftFlags(app);
	return { severity: driftSeverity(flags), flags };
};
