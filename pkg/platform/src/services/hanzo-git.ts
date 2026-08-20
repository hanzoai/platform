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
 *   HANZO_GIT_ORGANIZATION_ID  platform organization that owns builds from
 *                              this forge, the deployment-level fact that
 *                              GITHUB_APP_INSTALLATION_ID is for GitHub.
 */

/** Resolved Hanzo Git configuration. Never logged, never returned to a client. */
export interface HanzoGitConfig {
	/** Base URL with no trailing slash, e.g. `https://git.hanzo.ai`. */
	url: string;
	/** Origin of {@link url} — what an inbound delivery is matched against. */
	origin: string;
	webhookSecret: string;
	token?: string;
	organizationId: string;
}

export const HANZO_GIT_DEFAULT_URL = "https://git.hanzo.ai";

/**
 * Where the forge is, for callers that only need to reach it.
 *
 * The in-cluster CI Jobs — build, publish, e2e — clone source from here. They
 * need the address and nothing else, so they read it here rather than through
 * {@link hanzoGitConfig}, which additionally requires the webhook secret and
 * organization id that only an inbound delivery is about. One expression
 * resolves the address; {@link hanzoGitConfig} calls it too, so the default and
 * the override are stated once.
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
 * webhook secret and organization id that only a delivery is about.
 */
export function forgeReader(): Pick<HanzoGitConfig, "url" | "token"> {
	return { url: forgeUrl(), token: process.env.HANZO_GIT_TOKEN || undefined };
}

/**
 * The organization that owns builds of repositories on this forge — the
 * deployment-level fact `GITHUB_APP_INSTALLATION_ID`'s provider row is for
 * GitHub.
 *
 * A build takes it directly because a build is not a delivery: it needs to know
 * whose build it is, not how to verify a signature. {@link hanzoGitConfig}
 * reports this key alongside the webhook secret, since a delivery needs both.
 */
export function forgeOrganizationId(): string {
	const id = process.env.HANZO_GIT_ORGANIZATION_ID ?? "";
	if (!id) throw new HanzoGitNotConfigured(["HANZO_GIT_ORGANIZATION_ID"]);
	return id;
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
 */
const BESIDE_THE_REPO = /\.(git|wiki)$/;

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
	const organizationId = process.env.HANZO_GIT_ORGANIZATION_ID ?? "";

	const missing = [
		["HANZO_GIT_WEBHOOK_SECRET", webhookSecret],
		["HANZO_GIT_ORGANIZATION_ID", organizationId],
	].flatMap(([name, value]) => (value ? [] : [name as string]));
	if (missing.length > 0) throw new HanzoGitNotConfigured(missing);

	return {
		...forgeReader(),
		origin: new URL(url).origin,
		webhookSecret,
		organizationId,
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
