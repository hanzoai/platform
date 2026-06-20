/**
 * Shared plumbing for the four apps-lifecycle readers.
 *
 * Contract: `docs/APPS_LIFECYCLE.md` §"Populated by four readers running on
 * independent cron". The readers observe reality and write it into the `apps`
 * table; they never normalize (a floating tag is recorded verbatim so the drift
 * view can flag it). This module owns the bits all four share:
 *
 *   - a single Octokit factory (one auth story, one place)
 *   - the semver predicate + "newest" picker (drift math lives here, once)
 *   - the per-tuple partial upsert (a reader only ever writes its own columns)
 *
 * Each reader is otherwise independent and complete — they touch disjoint
 * columns and are scheduled on their own cron, so order never matters.
 */

import { Octokit } from "octokit";
import semver from "semver";
import { type App, apps, db, eq } from "../../db";

export type { App } from "../../db";

/** Strict semver tag: `vMAJOR.MINOR.PATCH`. The lifecycle is semver-only; any
 *  tag that fails this is a floating reference and counts as drift. The leading
 *  `v` is optional because some CRs/releases omit it (e.g. `1.19.5`). */
export function isSemverTag(tag: string | null | undefined): boolean {
	if (!tag) return false;
	return semver.valid(tag.replace(/^v/, "")) !== null;
}

/**
 * Pick the newest tag by semver order. Non-semver tags are ignored (a floating
 * `:multi-issuer` never wins "latest"). Returns `null` when no semver tag
 * exists. The returned value is the original tag string (leading `v` preserved
 * if the input had it) so callers store exactly what the registry published.
 */
export function newestSemver(tags: readonly string[]): string | null {
	let best: { tag: string; coerced: string } | null = null;
	for (const tag of tags) {
		const coerced = tag.replace(/^v/, "");
		if (semver.valid(coerced) === null) continue;
		if (best === null || semver.gt(coerced, best.coerced)) {
			best = { tag, coerced };
		}
	}
	return best?.tag ?? null;
}

/** Aggregate deployment health. Matches the `appHealth` enum (PR 1). */
export type Health = "green" | "yellow" | "red";

/**
 * Roll a deployment's replica counts up to a single health colour — the one
 * place this decision is made (used by `read_running_tag` and pinned by tests):
 *
 *   - `green`  — desired > 0 and every desired replica is ready
 *   - `yellow` — partially ready (rolling out), or desired == 0 (scaled to zero,
 *                intentional but not serving)
 *   - `red`    — desired > 0 and zero replicas ready (down / crashlooping)
 *
 * A missing deployment is `red` too, but that's decided at the call site (there
 * are no replica counts to pass here).
 */
export function rollupHealth(desired: number, ready: number): Health {
	if (desired === 0) return "yellow";
	if (ready >= desired) return "green";
	if (ready === 0) return "red";
	return "yellow";
}

/**
 * One Octokit, authed from the control-plane PAT. The readers poll org
 * container packages, fetch private universe CR files, and read GH Releases —
 * all org-scoped reads a single token covers. Distinct from the per-org GitHub
 * App auth in `utils/providers/github.ts` (that's for user-facing deploy flows;
 * this is the platform's own observation token).
 *
 * Token resolves from `GH_TOKEN` then `GITHUB_TOKEN`. Unauthenticated reads are
 * allowed (public packages) but rate-limited; readers degrade rather than crash.
 */
export function appsReaderOctokit(): Octokit {
	const auth = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || undefined;
	return new Octokit({ auth });
}

/**
 * Columns a reader is allowed to write. Each reader owns a disjoint slice; the
 * upsert below only ever touches the keys present in `patch`, never the
 * seed-owned topology (org/app/env/repo/registry/declared facts) nor another
 * reader's columns. `lastObserved` is stamped by the upsert itself.
 */
export type ObservedPatch = Partial<
	Pick<
		App,
		| "declaredTag"
		| "runningTag"
		| "latestTag"
		| "releaseUrl"
		| "releaseAssets"
		| "health"
		| "cluster"
		| "namespace"
	>
>;

/**
 * Write one reader's observed columns onto an existing apps row, by primary
 * key (`<org>/<app>/<env>`). Rows are created by the seed (PR 1); a reader only
 * updates. Always stamps `lastObserved` + `updatedAt` so the drift view's
 * "last seen" reflects the most recent successful read. Returns the number of
 * rows touched (0 ⇒ the seed hasn't created this row yet).
 */
export async function upsertObserved(
	id: string,
	patch: ObservedPatch,
): Promise<number> {
	const now = new Date();
	const rows = await db
		.update(apps)
		.set({ ...patch, lastObserved: now, updatedAt: now })
		.where(eq(apps.id, id))
		.returning({ id: apps.id });
	return rows.length;
}

/** All apps rows — the readers iterate this to know what to observe. The seed
 *  is the source of truth for which (org, app, env) tuples exist. */
export async function allApps(): Promise<App[]> {
	return db.select().from(apps);
}

/** `ghcr.io/hanzoai/iam` → `{ host: "ghcr.io", owner: "hanzoai", pkg: "iam" }`.
 *  Returns `null` for non-GHCR or malformed registries (only GHCR is polled for
 *  `latest_tag` today; GAR is a follow-up). */
export function parseGhcr(
	registry: string,
): { host: string; owner: string; pkg: string } | null {
	const m = /^ghcr\.io\/([^/]+)\/(.+)$/.exec(registry);
	if (!m) return null;
	return { host: "ghcr.io", owner: m[1] as string, pkg: m[2] as string };
}

/** `hanzoai/iam` → `{ owner: "hanzoai", repo: "iam" }`. */
export function parseRepo(
	repo: string,
): { owner: string; repo: string } | null {
	const [owner, name] = repo.split("/");
	if (!owner || !name) return null;
	return { owner, repo: name };
}
