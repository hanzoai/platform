import { IAM, type IAMConfig } from "@hanzo/iam/browser";

/**
 * Browser-side Hanzo IAM client (HIP-0111). The ONLY way the platform UI
 * starts a login: PKCE S256 redirect to `hanzo.id/v1/iam/oauth/authorize`.
 * No platform-local credential form.
 *
 * Issuer is `https://hanzo.id` (the per-brand OIDC issuer) — exactly the
 * console's proven prod path. Token + userinfo exchange hit `hanzo.id`
 * directly (it serves CORS for the OIDC endpoints); the platform origin
 * does NOT proxy `/v1/iam/oauth/*`, so no `proxyBaseUrl` is set.
 */
const SERVER_URL =
	process.env.NEXT_PUBLIC_IAM_SERVER_URL || "https://hanzo.id";
const CLIENT_ID = process.env.NEXT_PUBLIC_IAM_CLIENT_ID || "hanzo-platform";

/** Build the IAM client against the current origin's callback route. */
export function createIam(): IAM {
	const origin =
		typeof window !== "undefined"
			? window.location.origin
			: "https://platform.hanzo.ai";
	const config: IAMConfig = {
		serverUrl: SERVER_URL,
		clientId: CLIENT_ID,
		redirectUri: `${origin}/auth/callback`,
		scope: "openid profile email",
	};
	return new IAM(config);
}
