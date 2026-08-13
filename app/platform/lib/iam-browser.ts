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
const SERVER_URL = process.env.NEXT_PUBLIC_IAM_SERVER_URL || "https://hanzo.id";
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

/**
 * Where to land after the IAM round trip. The callback route is fixed (IAM
 * redirects to exactly one registered `redirect_uri`), so a page that needs the
 * user to come back to IT rather than to the dashboard parks the path here
 * first. Session-scoped: an abandoned sign-in must not redirect a later one.
 */
const RETURN_TO_KEY = "hanzo_iam_return_to";

/** Start the PKCE redirect, optionally returning to `returnTo` afterwards. */
export async function startSignIn(returnTo?: string): Promise<void> {
	if (typeof window !== "undefined") {
		if (returnTo) {
			window.sessionStorage.setItem(RETURN_TO_KEY, returnTo);
		} else {
			window.sessionStorage.removeItem(RETURN_TO_KEY);
		}
	}
	await createIam().signinRedirect();
}

/**
 * Read and clear the parked destination, defaulting to the dashboard.
 *
 * Only a same-origin absolute path is honoured — anything else (a full URL, or
 * the `//evil.com` form a browser reads as protocol-relative) is discarded, so
 * this can never become an open redirect off the back of a login.
 */
export function consumeReturnTo(): string {
	const fallback = "/dashboard/home";
	if (typeof window === "undefined") return fallback;
	const parked = window.sessionStorage.getItem(RETURN_TO_KEY);
	window.sessionStorage.removeItem(RETURN_TO_KEY);
	if (!parked || !parked.startsWith("/") || parked.startsWith("//")) {
		return fallback;
	}
	return parked;
}

/**
 * End the IAM session — the counterpart of `startSignIn`, and the one place
 * that knows a platform session has TWO halves.
 *
 * `createIam()` owns only the browser-side token; the SSR session is the
 * httpOnly `hanzo_iam_access_token` cookie that `/v1/iam/session` pins, and a
 * logout that drops one and leaves the other signs the user out of the UI while
 * `validateRequest` still lets them through. So: clear the cookie first (a
 * server round-trip that must land before we navigate away), then RP-initiated
 * logout, which clears local storage and hands off to `hanzo.id`.
 *
 * This is app auth logic, which is why it lives in the app. `@hanzo/ui` 5.x
 * shipped it as `useHanzoAuth` from `@hanzo/ui/navigation`; 8.x drops that
 * subpath, and correctly — a presentational component library cannot own a
 * session model.
 */
export async function signOutIam(): Promise<void> {
	await fetch("/v1/iam/session", { method: "DELETE" }).catch(() => {});
	await createIam().logout();
}
