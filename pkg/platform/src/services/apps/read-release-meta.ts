/**
 * read_release_meta — for each app's declared_tag, write `release_url` +
 * `release_assets`.
 *
 * Contract: `docs/APPS_LIFECYCLE.md` §"read_release_meta — gh release view for
 * declared_tag, writes release_url + release_assets" and the drift rule "GH
 * Release has 0 assets" → red. This is the reader that would have caught iam
 * v1.15.0 shipping with zero binaries: `release_assets == 0` on a declared
 * semver is loud drift.
 *
 * Keyed off `declared_tag` (what we intend to run) — so it depends on
 * `read_declared_tag` having run, but the dependency is data-only (no ordering
 * needed across crons; a stale declared_tag just yields stale release meta until
 * the next sweep). A non-semver or null declared_tag is skipped: there is no
 * meaningful release to look up for a floating reference.
 */

import { logger } from "../../lib/logger";
import {
	allApps,
	appsReaderOctokit,
	isSemverTag,
	parseRepo,
	upsertObserved,
} from "./shared";

/** GH release lookup result for a tag. `assets` is the uploaded-binary count. */
type ReleaseMeta = { url: string; assets: number } | null;

/**
 * Look up a GH Release by tag. Tries the tag verbatim, then with/without a
 * leading `v` (declared tags are inconsistent: `1.19.5` vs `v2.14.7`, and the
 * git tag may carry the other form). Returns `null` when no release exists for
 * any form (→ the contract's "✗ skipped" drift state).
 */
async function releaseForTag(
	octokit: ReturnType<typeof appsReaderOctokit>,
	owner: string,
	repo: string,
	tag: string,
): Promise<ReleaseMeta> {
	const candidates = Array.from(
		new Set([tag, tag.startsWith("v") ? tag.slice(1) : `v${tag}`]),
	);
	for (const candidate of candidates) {
		try {
			const res = await octokit.rest.repos.getReleaseByTag({
				owner,
				repo,
				tag: candidate,
			});
			return {
				url: res.data.html_url,
				assets: res.data.assets?.length ?? 0,
			};
		} catch (err) {
			const status = (err as { status?: number }).status;
			if (status === 404) continue; // try the next candidate form
			logger.warn(
				{ owner, repo, tag: candidate, err: (err as Error).message },
				"[read_release_meta] release lookup failed",
			);
			return null;
		}
	}
	return null;
}

/**
 * Run one sweep: for every app with a semver `declared_tag`, resolve its GH
 * Release and write `release_url` + `release_assets`. Apps with a null/floating
 * declared_tag have their release columns cleared (no release applies to a
 * floating reference), keeping the drift view honest.
 */
export async function readReleaseMeta(): Promise<{
	scanned: number;
	updated: number;
}> {
	const octokit = appsReaderOctokit();
	const rows = await allApps();
	let updated = 0;

	for (const row of rows) {
		// Only semver declared tags have a meaningful release to verify.
		if (!isSemverTag(row.declaredTag)) {
			const n = await upsertObserved(row.id, {
				releaseUrl: null,
				releaseAssets: 0,
			});
			if (n > 0) updated += 1;
			continue;
		}
		const repo = parseRepo(row.repo);
		if (!repo) continue;

		const meta = await releaseForTag(
			octokit,
			repo.owner,
			repo.repo,
			row.declaredTag as string,
		);
		const n = await upsertObserved(row.id, {
			releaseUrl: meta?.url ?? null,
			releaseAssets: meta?.assets ?? 0,
		});
		if (n > 0) updated += 1;
	}

	logger.info(
		{ scanned: rows.length, updated },
		"[read_release_meta] sweep done",
	);
	return { scanned: rows.length, updated };
}
