/**
 * Release-meta reader — the second "observe" reader of the control plane
 * (`docs/APPS_LIFECYCLE.md` §1, readers `read_latest_tag` + `read_release_meta`,
 * unified into one pass), the documented follow-up to the live inventory.
 *
 * The inventory reader (`inventory.ts`) writes what is DECLARED (operator CR
 * `spec.image.tag`) and what is RUNNING (live Deployment image). This reader
 * supplies the third tag the drift view compares — what is the newest RELEASED
 * artifact — plus the release-artifact integrity facts (`releaseUrl`,
 * `releaseAssets`) that turn an opaque `no-release` into a real verdict
 * (`stale` / `zero-assets`).
 *
 * Source of truth: the GitHub Release of each app's `repo` (`owner/repo`),
 * via the repo's "latest release" (GitHub's own non-prerelease/non-draft
 * latest). The reader does NOT invent a tag — it records exactly what GitHub
 * publishes, so the drift checker's `stale` (declared ≠ latest) and
 * `zero-assets` (release shipped 0 binaries) flags are grounded in reality.
 *
 * SEPARATION OF CONCERNS (one way, orthogonal):
 *   - It reads the `apps` table for the distinct `repo`s the inventory already
 *     discovered — it never lists clusters and never invents rows. So a repo is
 *     only release-checked once it is actually declared somewhere, and the two
 *     readers compose: inventory owns declared/running/health/topology, this
 *     reader owns latest/release-url/release-assets. Neither clobbers the
 *     other's columns (the upsert `set` lists ONLY the three release columns).
 *   - It is read-only against GitHub and writes only platform's own SQLite, so
 *     like the inventory reader it cannot perturb the control plane.
 *
 * Auth: a GitHub token from `GH_TOKEN` (already present in the platform pod,
 * the same credential the CI build path uses). With no token it runs
 * unauthenticated (low rate limit) — fine for a dev box; in-cluster it is
 * always authenticated.
 */

import { db, eq } from "@hanzo/platform/db";
import { apps } from "@hanzo/platform/db/schema";
import { Octokit } from "octokit";

/** A single repo's resolved release facts (null = no release found). */
export interface ReleaseMeta {
	/** The newest released tag, verbatim from GitHub (e.g. `v1.25.2`). */
	latestTag: string | null;
	/** The HTML URL of that release. */
	releaseUrl: string | null;
	/** Number of binary assets attached to that release (0 = none shipped). */
	releaseAssets: number;
}

/** Empty release facts — the value written when a repo has no GitHub Release. */
export const NO_RELEASE: ReleaseMeta = {
	latestTag: null,
	releaseUrl: null,
	releaseAssets: 0,
};

/**
 * Split an `owner/repo` coordinate into its two parts. The `apps.repo` column
 * is the GitHub coordinate the inventory derived from the image path
 * (`ghcr.io/hanzoai/iam` → `hanzoai/iam`). Image paths with an extra segment
 * (`hanzoai/insights/capture`) collapse to `owner=hanzoai`, `repo=insights`
 * (the GitHub repo; the trailing segment is a monorepo image, not a repo).
 * Returns null when there is no `owner/repo` to query (bare third-party names
 * like `grafana/grafana` are still valid `owner/repo`; a single bare token is
 * not).
 */
export function parseRepoCoordinate(
	repo: string,
): { owner: string; name: string } | null {
	const parts = repo.split("/").filter(Boolean);
	if (parts.length < 2) return null;
	return { owner: parts[0]!, name: parts[1]! };
}

/**
 * The GitHub-release wire shape we read (a subset of `repos.getLatestRelease`).
 * Kept minimal so the mapper is unit-testable without Octokit's full types.
 */
export interface GithubReleaseLike {
	tag_name?: string;
	html_url?: string;
	assets?: Array<unknown>;
}

/** Map a GitHub release payload to `ReleaseMeta`. Pure; no IO. */
export function releaseMetaFrom(
	release: GithubReleaseLike | null | undefined,
): ReleaseMeta {
	if (!release || !release.tag_name) return NO_RELEASE;
	return {
		latestTag: release.tag_name,
		releaseUrl: release.html_url ?? null,
		releaseAssets: release.assets?.length ?? 0,
	};
}

/** Construct the reader's Octokit (token-authenticated when `GH_TOKEN` is set). */
export function makeOctokit(token = process.env.GH_TOKEN): Octokit {
	return token ? new Octokit({ auth: token }) : new Octokit();
}

/**
 * Fetch the latest-release facts for one `owner/repo`. A 404 (no release, or a
 * repo the token cannot see) resolves to `NO_RELEASE` — that is a legitimate
 * observation, not an error (the drift checker turns it into the honest
 * `no-release` flag). Any other failure throws so the caller can decide whether
 * to skip the repo (the per-repo loop swallows + logs, never crashing the pass).
 */
export async function fetchReleaseMeta(
	octokit: Octokit,
	owner: string,
	name: string,
): Promise<ReleaseMeta> {
	try {
		const res = await octokit.rest.repos.getLatestRelease({
			owner,
			repo: name,
		});
		return releaseMetaFrom(res.data as GithubReleaseLike);
	} catch (err) {
		if (isNotFound(err)) return NO_RELEASE;
		throw err;
	}
}

/** True for an Octokit/HTTP 404 (no release published, or repo not visible). */
function isNotFound(err: unknown): boolean {
	return (err as { status?: number })?.status === 404;
}

export interface ReleaseSyncResult {
	/** Distinct repos examined this pass. */
	repos: number;
	/** Rows whose release columns were updated. */
	updated: number;
}

/**
 * Reconcile the release columns of every `apps` row from GitHub Releases.
 *
 * One GitHub call per DISTINCT repo (apps share a repo across envs, so iam/main
 * and iam/test cost one call), then a single bulk update per repo writes the
 * three release columns to every row of that repo. Owns ONLY
 * `latestTag`/`releaseUrl`/`releaseAssets` — the inventory reader's
 * declared/running/health columns are never touched.
 *
 * Per-repo failures are logged and skipped; the pass always completes so one
 * unreachable repo cannot stall the board.
 */
export async function syncReleases(
	octokit: Octokit = makeOctokit(),
): Promise<ReleaseSyncResult> {
	// Distinct repos the inventory has already discovered.
	const rows = await db.select({ repo: apps.repo }).from(apps);
	const repos = [...new Set(rows.map((r) => r.repo))];

	const now = new Date();
	let updated = 0;
	let examined = 0;

	for (const repo of repos) {
		const coord = parseRepoCoordinate(repo);
		if (!coord) continue; // not an owner/repo coordinate — nothing to query
		examined += 1;

		let meta: ReleaseMeta;
		try {
			meta = await fetchReleaseMeta(octokit, coord.owner, coord.name);
		} catch (err) {
			console.error(`[apps-release] ${repo} release lookup failed`, err);
			continue; // leave this repo's columns as-is; try again next pass
		}

		// Bulk-write the three release columns to every env row of this repo.
		const res = await db
			.update(apps)
			.set({
				latestTag: meta.latestTag,
				releaseUrl: meta.releaseUrl,
				releaseAssets: meta.releaseAssets,
				updatedAt: now,
			})
			.where(eq(apps.repo, repo))
			.run();
		updated += res.changes ?? 0;
	}

	return { repos: examined, updated };
}

/**
 * Refresh release facts for a single repo on demand (e.g. right after a release
 * is published, driven by a `release` webhook). Returns the resolved meta.
 */
export async function syncReleaseForRepo(
	repo: string,
	octokit: Octokit = makeOctokit(),
): Promise<ReleaseMeta> {
	const coord = parseRepoCoordinate(repo);
	if (!coord) return NO_RELEASE;
	const meta = await fetchReleaseMeta(octokit, coord.owner, coord.name);
	await db
		.update(apps)
		.set({
			latestTag: meta.latestTag,
			releaseUrl: meta.releaseUrl,
			releaseAssets: meta.releaseAssets,
			updatedAt: new Date(),
		})
		.where(eq(apps.repo, repo))
		.run();
	return meta;
}
