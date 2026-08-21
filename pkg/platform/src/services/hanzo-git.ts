/**
 * Hanzo Git — the canonical Hanzo forge at git.hanzo.ai.
 *
 * Hanzo Git is Hanzo's own forge (source: hanzoai/git, image
 * ghcr.io/hanzoai/git), not a third-party integration. It is therefore
 * configured the way platform's other first-class credentials are — from the
 * environment, synced by the `platform-app-kms-sync` KMSSecret out of KMS
 * `hanzo/platform` (env=prod) into the `platform-app-secrets` Secret — and
 * NOT from a per-tenant provider row a user pastes a token into.
 *
 * Deliberately distinct from `services/gitea.ts`, which is the inherited
 * third-party integration for connecting platform to somebody else's Gitea
 * server. Same wire format, different product; conflating them is how you end
 * up with two ways to reach one forge.
 *
 * Interop note: Hanzo Git speaks a Gitea-compatible request/response SHAPE and
 * webhook wire format (`X-Gitea-Event` / `X-Gitea-Signature`), but it is served
 * at `/v1/...`, NOT `/api/v1/...` — the latter answers 404 "Not found.", which
 * reads exactly like the API being switched off and has sent more than one
 * investigation down the wrong path. The shape is an implementation detail of
 * the wire; the prefix is ours, and it is `/v1`.
 *
 * Env:
 *   HANZO_GIT_URL              base URL (default https://git.hanzo.ai)
 *   HANZO_GIT_WEBHOOK_SECRET   HMAC-SHA256 secret shared with the forge's
 *                              webhook config. Required to accept deliveries.
 *   HANZO_GIT_TOKEN            API token for reading `hanzo.yml` from private
 *                              repos. Optional — public repos need none.
 *
 * Whose build it is is not among them. The forge serves every organization's
 * repositories, so the answer is per-repository and `services/org` resolves it
 * from the owner.
 */

/** Resolved Hanzo Git configuration. Never logged, never returned to a client. */
export interface HanzoGitConfig {
	/** Base URL with no trailing slash, e.g. `https://git.hanzo.ai`. */
	url: string;
	/** Origin of {@link url} — what an inbound delivery is matched against. */
	origin: string;
	webhookSecret: string;
	token?: string;
}

export const HANZO_GIT_DEFAULT_URL = "https://git.hanzo.ai";

/**
 * Where the forge is, for callers that only need to reach it.
 *
 * The in-cluster CI Jobs — build, publish, e2e — clone source from here. They
 * need the address and nothing else, so they read it here rather than through
 * {@link hanzoGitConfig}, which additionally requires the webhook secret that
 * only an inbound delivery is about. One expression resolves the address;
 * {@link hanzoGitConfig} calls it too, so the default and the override are
 * stated once.
 */
export function forgeUrl(): string {
	return (process.env.HANZO_GIT_URL || HANZO_GIT_DEFAULT_URL).replace(
		/\/+$/,
		"",
	);
}

/** Host of {@link forgeUrl} — the name a `.netrc` `machine` line takes. */
export function forgeHost(): string {
	return new URL(forgeUrl()).host;
}

/**
 * Address and read credential — everything reading a file from the forge takes.
 *
 * A build reads its `hanzo.yml` from the repository it clones, both before it
 * runs and after it finishes, and neither read is an inbound delivery. So they
 * take this rather than {@link hanzoGitConfig}, which additionally requires the
 * webhook secret that only a delivery is about.
 */
export function forgeReader(): Pick<HanzoGitConfig, "url" | "token"> {
	return { url: forgeUrl(), token: process.env.HANZO_GIT_TOKEN || undefined };
}

/** One path segment of a repository path: a name, starting with a letter or digit. */
const REPO_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Suffixes that address something beside the repository at `owner/name`.
 *
 * `.git` belongs to the git protocol and the git context appends it. `.wiki`
 * names the repository's wiki, which the forge keeps as a repository of its own
 * with its own contents and its own writers — `owner/name` and `owner/name.wiki`
 * are two repositories, and a build reads the first.
 *
 * Case-insensitive, for the same reason {@link repoName} lowercases: the forge
 * reads a name without regard to case, so this decides about the same name the
 * forge would resolve rather than about the caller's spelling of it.
 */
const BESIDE_THE_REPO = /\.(git|wiki)$/i;

/**
 * A repository on the forge is named `owner/name`.
 *
 * Everything a build reads it reads from this path under {@link forgeUrl} — the
 * `hanzo.yml` describing the build, and the git context BuildKit clones — so the
 * path names a repository and carries nothing else: two name segments, no
 * scheme, no host, no ref fragment, no traversal, and nothing beside the
 * repository itself.
 *
 * Returns what is wrong with `repo`, or null when it names a repository. Same
 * shape as the other build-request rules, so a front door answers 400 with the
 * message and the build path refuses on the same call.
 */
export function repoProblem(repo: string): string | null {
	const [owner, name, ...rest] = repo.split("/");
	if (
		!owner ||
		!name ||
		rest.length > 0 ||
		!REPO_SEGMENT.test(owner) ||
		!REPO_SEGMENT.test(name)
	) {
		return `"${repo}" does not name a repository: ${forgeHost()} repositories are owner/name.`;
	}
	const beside = BESIDE_THE_REPO.exec(name);
	if (beside) {
		return `"${repo}" does not name a repository: drop the ${beside[0]}, ${forgeHost()} serves the repository at owner/name.`;
	}
	return null;
}

/**
 * The forge's own name for a repository path.
 *
 * The forge resolves a repository by its lowercase name, so `HanzoAI/KMS` and
 * `hanzoai/kms` are one repository and this is the one name it answers to.
 * Everything keyed by the path — the buildJob row, its dedupe, the git context —
 * is keyed by this, so one repository is one key however a caller spelled it.
 */
export function repoName(repo: string): string {
	return repo.toLowerCase();
}

/**
 * A commit is named by its object id, and an object id is hex: 40 digits of
 * SHA-1 or 64 of SHA-256.
 *
 * Whole, not a prefix. The value addresses one commit twice over — it keys the
 * buildJob row and it is the git context BuildKit resolves — and a prefix is
 * neither of those: git resolves an abbreviation against a local object store,
 * which a fetch does not have, and two abbreviations of one commit key two rows.
 * The two lengths are the two hashes git names objects with; nothing else is an
 * object id.
 */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/**
 * Returns what is wrong with `sha`, or null when it names a commit. Same shape
 * as {@link repoProblem}: a repository path and a commit are the two halves of
 * a source address, and both front doors answer with the message.
 */
export function commitProblem(sha: string): string | null {
	return OBJECT_ID.test(sha)
		? null
		: `"${sha}" does not name a commit: expected a whole object id — 40 hex digits, or 64.`;
}

/**
 * The one spelling of a commit id, folded like {@link repoName} folds a
 * repository: hex is case-insensitive, so both spellings name one commit, key
 * one row, and address one git context.
 */
export function commitName(sha: string): string {
	return sha.toLowerCase();
}

/**
 * A push names a BRANCH or a TAG. Those are the two things git moves and the
 * two things a build can be about, so they are the two shapes a ref takes here.
 *
 * The distinction is the whole point rather than a formality. A branch head
 * moves and a tag does not, so which of the two a commit arrived on decides
 * whether an image may carry a version and whether a deploy may follow. Every
 * reader asks {@link branchOf} or {@link tagOf} and gets one answer or none —
 * there is no third spelling to read a branch out of a tag with.
 */
const BRANCH = "refs/heads/";
const TAG = "refs/tags/";

/** What a ref names: the kind of thing git moves, and the name it moves. */
interface Named {
	/** The forge path that answers for this kind: `branches` or `tags`. */
	kind: "branches" | "tags";
	name: string;
}

/** Read a ref as the two parts it is made of, or null when it is neither. */
function readRef(ref: string): Named | null {
	const branch = branchOf(ref);
	if (branch) return { kind: "branches", name: branch };
	const tag = tagOf(ref);
	if (tag) return { kind: "tags", name: tag };
	return null;
}

/**
 * The characters and sequences git refuses inside a ref name.
 *
 * A control character or a space, the five its own pattern syntax already
 * spells something with (`~^:?*[`), a backslash, `..`, `@{`, and a trailing
 * dot.
 */
const REFUSED = /[\p{Cc} ~^:?*[\\]|\.\.|@\{|\.$/u;

/**
 * Longest name the forge stores. A loose ref is a file whose path is the name,
 * and a path component tops out here; nothing a person pushes comes near it.
 */
const NAME_MAX = 255;

/**
 * What is wrong with the name part of a ref, or null when git would make it.
 *
 * `git check-ref-format` is the rule git applies when a ref is CREATED, so a
 * name failing it is a name no push produced. It is also what keeps a ref
 * addressable. The name becomes a path segment on the forge, and `..` is the
 * one sequence a URL path resolves away: percent-encoding a segment does not
 * touch a dot, so a name carrying `..` re-addresses the request to a repository
 * the caller never named. Reading git's rule here makes the name we may ask
 * about and the name the forge can hold one thing.
 */
function nameProblem(name: string): string | null {
	if (name.length > NAME_MAX) return `it is longer than ${NAME_MAX} characters`;
	if (name === "@") return "git keeps `@` for itself";
	const refused = REFUSED.exec(name);
	if (refused) {
		return `git allows no ${JSON.stringify(refused[0])} in a ref name`;
	}
	for (const part of name.split("/")) {
		if (!part) return "it has an empty path component";
		if (part.startsWith(".")) return `"${part}" begins with a dot`;
		if (part.endsWith(".lock")) return `"${part}" ends with .lock`;
	}
	return null;
}

/**
 * Returns what is wrong with `ref`, or null when it names a branch or a tag.
 * Same shape as {@link repoProblem} and {@link commitProblem}, so a front door
 * answers 400 with the message and the build path refuses on the same call.
 */
export function refProblem(ref: string): string | null {
	const read = readRef(ref);
	if (!read) {
		return `"${ref}" does not name a branch or a tag: expected ${BRANCH}<name> or ${TAG}<name>.`;
	}
	const problem = nameProblem(read.name);
	return problem
		? `"${ref}" does not name a branch or a tag: ${problem}.`
		: null;
}

/** The branch a ref names, or null when it names a tag or nothing. */
export function branchOf(ref: string): string | null {
	return ref.startsWith(BRANCH) ? ref.slice(BRANCH.length) || null : null;
}

/** The tag a ref names, or null when it names a branch or nothing. */
export function tagOf(ref: string): string | null {
	return ref.startsWith(TAG) ? ref.slice(TAG.length) || null : null;
}

/**
 * A name as URL path segments: each part encoded, `/` kept as the separator.
 *
 * The encoding does a different job from {@link nameProblem} and both are
 * needed. The name rule refuses what git refuses; git permits `#` and `%`, and
 * both mean something to a URL — `foo#bar` would ask about `foo` and drop the
 * rest as a fragment. So the rule decides the name and this decides how it
 * travels.
 */
function segments(name: string): string {
	return name.split("/").map(encodeURIComponent).join("/");
}

/**
 * The commit a ref resolves to on the forge, or null when the forge does not
 * resolve it.
 *
 * A ref and a commit are one fact stated two ways, and only the forge holds it.
 * So a door that is not a signed delivery states the REF — a name a person
 * means and the forge can answer for — and the commit follows from it here.
 * There is no door at which both halves are stated, which is what keeps the two
 * from disagreeing.
 *
 * Addressed by kind, at the endpoint that answers for exactly one name:
 * `/branches/<name>` and `/tags/<name>` each resolve a single ref and hand back
 * the commit it points at. The ref-listing endpoint answers by PREFIX, so
 * `heads/mai` would come back holding `main`'s commit — a name that resolves to
 * a neighbour's commit is the failure this whole binding exists to prevent.
 * The tag endpoint also dereferences: an annotated tag is an object of its own,
 * and its commit is what a build checks out.
 *
 * Both halves of the address are asked the rule that makes them a name — the
 * same {@link repoProblem} and {@link refProblem} the front doors answer 400
 * with. Asked HERE too, where the URL is built, so a repository and a ref that
 * were never a name cannot reach the wire whatever called this.
 */
export async function commitAt(
	cfg: Pick<HanzoGitConfig, "url" | "token">,
	repo: string,
	ref: string,
): Promise<string | null> {
	const read = readRef(ref);
	if (!read || nameProblem(read.name) || repoProblem(repo)) return null;
	const headers: Record<string, string> = { Accept: "application/json" };
	if (cfg.token) headers.Authorization = `token ${cfg.token}`;
	const url = `${cfg.url}/v1/repos/${segments(repo)}/${read.kind}/${segments(read.name)}`;
	const res = await fetch(url, { headers });
	if (!res.ok) return null;
	// One shape per endpoint: a branch carries `commit.id`, a tag `commit.sha`.
	const body = (await res.json()) as {
		commit?: { id?: string; sha?: string };
	};
	const sha = body.commit?.id ?? body.commit?.sha;
	return sha && !commitProblem(sha) ? commitName(sha) : null;
}

/** Why Hanzo Git is not usable, in words an operator can act on. */
export class HanzoGitNotConfigured extends Error {
	constructor(missing: string[]) {
		super(
			`Hanzo Git is not configured: ${missing.join(", ")} unset. ` +
				"Add the key(s) to KMS hanzo/platform and to the platform-app-kms-sync KMSSecret.",
		);
		this.name = "HanzoGitNotConfigured";
	}
}

/**
 * Read Hanzo Git's configuration from the environment.
 *
 * Fails loud and specific when a key is missing rather than degrading to an
 * unverified webhook — an unauthenticated build trigger is worse than a dead
 * one. Returns null only when Hanzo Git is entirely unconfigured, so callers
 * can distinguish "not wired up yet" from "wired up wrong".
 */
export function hanzoGitConfig(): HanzoGitConfig {
	const url = forgeUrl();
	const webhookSecret = process.env.HANZO_GIT_WEBHOOK_SECRET ?? "";
	if (!webhookSecret) {
		throw new HanzoGitNotConfigured(["HANZO_GIT_WEBHOOK_SECRET"]);
	}

	return {
		...forgeReader(),
		origin: new URL(url).origin,
		webhookSecret,
	};
}

/**
 * Does a delivery claiming this origin actually come from our forge?
 *
 * A webhook names its forge via `repository.html_url`'s origin. Matching it
 * against the configured URL is not authentication — the HMAC is — it is how
 * we refuse to even look up a secret for a forge we do not run.
 */
export function isHanzoGitOrigin(origin: string, cfg: HanzoGitConfig): boolean {
	return origin === cfg.origin;
}
