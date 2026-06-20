/**
 * read_latest_tag — poll GHCR per app, write `apps.latest_tag`.
 *
 * Contract: `docs/APPS_LIFECYCLE.md` §"read_latest_tag — polls GHCR/GAR per app,
 * writes latest_tag". `latest_tag` is the newest *semver* image tag the registry
 * has published. Floating tags (`:main`, `:latest`, `:multi-issuer`) are ignored
 * for "latest" so a service that only ever ships floating tags reads `latest =
 * null` — itself a drift signal vs a declared semver. This anti-patterns the
 * "memory drift" row in the contract: latest is read from the registry, never
 * remembered.
 *
 * GAR is out of scope for now (every managed service is on GHCR); a row whose
 * registry isn't `ghcr.io/...` is skipped, not failed.
 */

import { logger } from "../../lib/logger";
import {
	allApps,
	appsReaderOctokit,
	newestSemver,
	parseGhcr,
	upsertObserved,
} from "./shared";

/** All container-version tags for one GHCR package (paginated). The GH API
 *  needs `/` in the package name percent-encoded. Returns `[]` (not throw) when
 *  the package is missing or unreadable so one bad app never stalls the sweep. */
async function ghcrTags(
	octokit: ReturnType<typeof appsReaderOctokit>,
	owner: string,
	pkg: string,
): Promise<string[]> {
	const packageName = encodeURIComponent(pkg);
	try {
		const versions = await octokit.paginate(
			octokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg,
			{
				org: owner,
				package_type: "container",
				package_name: packageName,
				per_page: 100,
				state: "active",
			},
		);
		const tags: string[] = [];
		for (const v of versions) {
			const ct = (v.metadata as { container?: { tags?: string[] } } | undefined)
				?.container?.tags;
			if (ct) tags.push(...ct);
		}
		return tags;
	} catch (err) {
		const status = (err as { status?: number }).status;
		// 404 = package not published yet (e.g. a control-plane app with no image);
		// not an error condition for this reader.
		if (status === 404) {
			logger.info({ owner, pkg }, "[read_latest_tag] no GHCR package");
		} else {
			logger.warn(
				{ owner, pkg, err: (err as Error).message },
				"[read_latest_tag] GHCR list failed",
			);
		}
		return [];
	}
}

/**
 * Run one sweep: for every apps row on a GHCR registry, resolve the newest
 * semver tag and write `latest_tag`. Idempotent; safe to run on any cron.
 * Returns a small summary for the scheduler log.
 */
export async function readLatestTag(): Promise<{
	scanned: number;
	updated: number;
}> {
	const octokit = appsReaderOctokit();
	const rows = await allApps();
	let updated = 0;

	for (const row of rows) {
		const ghcr = parseGhcr(row.registry);
		if (!ghcr) {
			logger.info(
				{ id: row.id, registry: row.registry },
				"[read_latest_tag] non-GHCR registry, skipping",
			);
			continue;
		}
		const tags = await ghcrTags(octokit, ghcr.owner, ghcr.pkg);
		const latest = newestSemver(tags);
		// Only write when we learned something — never clobber a known latest with
		// null on a transient list failure.
		if (latest === null && tags.length === 0) continue;
		const n = await upsertObserved(row.id, { latestTag: latest });
		if (n > 0) updated += 1;
	}

	logger.info(
		{ scanned: rows.length, updated },
		"[read_latest_tag] sweep done",
	);
	return { scanned: rows.length, updated };
}
