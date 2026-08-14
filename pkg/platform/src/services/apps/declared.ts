/**
 * Declared state — what each app is SUPPOSED to run.
 *
 * The board compares three tags and owns none of them. `runningTag` is observed
 * from the live workload and `latestTag` from the registry, both already read.
 * `declaredTag` is the third, and it was null for every app in the fleet: 336
 * rows, three orgs, not one declared tag among them. The board could show what
 * IS and never what OUGHT, so drift — the whole reason it exists — was
 * uncomputable.
 *
 * The reader that was supposed to supply it takes `spec.image.tag` off an
 * operator `App` CR (`apps.hanzo.ai`). There are zero such CRs in the fleet.
 * There were 82 once, and the module still says so; the estate moved to CD
 * Applications rendering a chart over a values file, and the reader kept asking
 * a question the cluster stopped answering. A reader that finds nothing looks
 * exactly like a fleet that declares nothing.
 *
 * Declared state lives in each org's universe repo, and every Application
 * already carries the pointer to its own:
 *
 *   sources:
 *     - chart: app                       # oci.hanzo.ai/charts, the shape
 *       helm: { valueFiles: ["$values/deploy/lux-mainnet/explorer.yaml"] }
 *     - ref: values                      # the org's universe, the content
 *       repoURL: https://git.hanzo.ai/lux/universe
 *       targetRevision: main
 *
 * So nothing here needs a per-org registry of repos, a clone, or a checkout.
 * The app names its repo, its revision and its file; this reads that file and
 * takes `image.tag`. An org is onboarded by CD reconciling it — which is the
 * only way an app gets here at all — and never by an entry in a second list
 * that would then have to be kept true.
 */

import type { CdApplication } from "./delivery";

/** Where one app's declared state is written down. */
export type DeclaredRef = {
	/** The universe repo, e.g. `https://git.hanzo.ai/lux/universe`. */
	repoURL: string;
	/** Branch or tag CD reconciles from, e.g. `main`. */
	revision: string;
	/** Repo-relative values file, e.g. `deploy/lux-mainnet/explorer.yaml`. */
	file: string;
};

/** `$values/` marks a path as belonging to the source that carries `ref: values`. */
const VALUES_PREFIX = "$values/";

/**
 * The pointer an Application carries to its own declared state, or null when it
 * carries none — a hand-written app with no values file, or a chart pinned with
 * its values inline. Null is a real answer here, not a failure: that app's
 * declared tag is genuinely not written in a universe.
 */
export function declaredRefOf(app: CdApplication): DeclaredRef | null {
	const sources = [app.spec?.source, ...(app.spec?.sources ?? [])].filter(
		(s): s is NonNullable<typeof s> => !!s,
	);
	// The file is named by the CHART source and lives in the VALUES source, so
	// neither alone is enough. `$values` is the ref that joins them, and it is
	// resolved rather than assumed: an app whose values ref is named something
	// else must not silently read the chart repo instead.
	const withFile = sources.find((s) =>
		s.helm?.valueFiles?.some((f) => f.startsWith(VALUES_PREFIX)),
	);
	const file = withFile?.helm?.valueFiles?.find((f) =>
		f.startsWith(VALUES_PREFIX),
	);
	if (!file) return null;

	const ref = sources.find((s) => s.ref === "values");
	if (!ref?.repoURL) return null;

	return {
		repoURL: ref.repoURL.replace(/\.git$/, "").replace(/\/+$/, ""),
		revision: ref.targetRevision || "main",
		file: file.slice(VALUES_PREFIX.length),
	};
}

/**
 * The raw-content URL for a file in a Forgejo/Gitea repo.
 *
 * `/raw/branch/<rev>/<path>` is the branch form. A revision that is a commit sha
 * needs `/raw/commit/`, and one that is a tag needs `/raw/tag/` — CD reconciles
 * from a branch for every app in this fleet, so the branch form is what is
 * built, and a revision that is plainly a sha is refused rather than fetched
 * from a URL that would 404 and read like a missing file.
 */
export function rawUrl(ref: DeclaredRef): string | null {
	if (/^[0-9a-f]{7,40}$/i.test(ref.revision)) return null;
	return `${ref.repoURL}/raw/branch/${ref.revision}/${ref.file}`;
}

/**
 * The declared image tag in a universe values file.
 *
 * Parsed with a line reader rather than a YAML library, because this needs two
 * scalars out of one known block and pulling a parser in for that is a
 * dependency the whole service then carries. `image:` at column zero, `tag:`
 * and `repository:` indented under it — the shape every file in every universe
 * is written in, and a file that does not match returns null instead of a
 * guess.
 */
export function declaredFromValues(
	yaml: string,
): { repository: string | null; tag: string | null } | null {
	const lines = yaml.split("\n");
	const start = lines.findIndex((l) => /^image:\s*$/.test(l));
	if (start === -1) return null;
	let repository: string | null = null;
	let tag: string | null = null;
	for (const line of lines.slice(start + 1)) {
		// The block ends at the next line that starts a key at column zero.
		if (/^\S/.test(line)) break;
		const m = /^\s+(repository|tag):\s*(.+?)\s*$/.exec(line);
		if (!m) continue;
		const value = m[2]!.replace(/^["']|["']$/g, "");
		if (m[1] === "repository") repository = value;
		else tag = value;
	}
	return { repository, tag };
}

/** Fetch a text file. Injected so the parsing above is testable with no network. */
export type FetchText = (url: string) => Promise<string | null>;

/**
 * Read one file from the forge.
 *
 * A universe is PRIVATE, so this carries a token. Without one the forge answers
 * 303 to its login page — and a redirect that is followed lands on a 200 whose
 * body is HTML. That body parses as "no image block", which this module would
 * report as "declares nothing" for every app in the fleet: the exact
 * null-for-everything the reader exists to fix, arrived at from the other side
 * and looking identical. So redirects are NOT followed, and a body that is not
 * plainly YAML is refused rather than parsed.
 *
 * FORGE_TOKEN is a read-only forge token, sealed in KMS like every other
 * credential this service holds. Absent, this returns null for every file and
 * the board keeps saying "unknown" — which is true, and is what it said before.
 */
export const fetchText: FetchText = async (url) => {
	const token = process.env.FORGE_TOKEN;
	try {
		const res = await fetch(url, {
			redirect: "manual",
			headers: token ? { Authorization: `token ${token}` } : {},
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) return null;
		const body = await res.text();
		// A login page is HTML and a values file is not. Cheaper and surer than
		// trusting a content type the forge sets for raw bytes.
		return /^\s*</.test(body) ? null : body;
	} catch {
		return null;
	}
};

/**
 * Declared tags for a set of Applications, keyed by Application name.
 *
 * Files are fetched once each: several apps in one universe share a repo, and a
 * fleet of 326 would otherwise re-read the same handful of directories. An app
 * whose file cannot be read is absent from the map rather than present as null
 * — the caller must be able to tell "declares nothing" from "could not look",
 * and writing null for the second would erase a true value on a transient
 * failure of one forge.
 */
export async function readDeclared(
	apps: CdApplication[],
	get: FetchText = fetchText,
): Promise<Map<string, string>> {
	const byUrl = new Map<string, string[]>();
	for (const app of apps) {
		const name = app.metadata?.name;
		const ref = name ? declaredRefOf(app) : null;
		const url = ref ? rawUrl(ref) : null;
		if (!name || !url) continue;
		const names = byUrl.get(url);
		if (names) names.push(name);
		else byUrl.set(url, [name]);
	}

	const out = new Map<string, string>();
	await Promise.all(
		[...byUrl].map(async ([url, names]) => {
			const body = await get(url);
			const tag = body ? declaredFromValues(body)?.tag : null;
			if (!tag) return;
			for (const name of names) out.set(name, tag);
		}),
	);
	return out;
}
