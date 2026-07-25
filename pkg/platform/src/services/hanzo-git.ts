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
 * Interop note: Hanzo Git today speaks a Gitea-compatible HTTP API and webhook
 * wire format (`/api/v1/...`, `X-Gitea-Event` / `X-Gitea-Signature`). That is
 * an implementation detail of the wire, never a name for the product.
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
	const url = (process.env.HANZO_GIT_URL || HANZO_GIT_DEFAULT_URL).replace(
		/\/+$/,
		"",
	);
	const webhookSecret = process.env.HANZO_GIT_WEBHOOK_SECRET ?? "";
	const organizationId = process.env.HANZO_GIT_ORGANIZATION_ID ?? "";

	const missing = [
		["HANZO_GIT_WEBHOOK_SECRET", webhookSecret],
		["HANZO_GIT_ORGANIZATION_ID", organizationId],
	].flatMap(([name, value]) => (value ? [] : [name as string]));
	if (missing.length > 0) throw new HanzoGitNotConfigured(missing);

	return {
		url,
		origin: new URL(url).origin,
		webhookSecret,
		token: process.env.HANZO_GIT_TOKEN || undefined,
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
