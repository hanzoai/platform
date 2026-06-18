import {
	auth,
	IAM_CONFIGURED,
	IAM_PROVIDER_ID,
	validateRequest,
} from "@hanzo/platform/lib/auth";
import type { GetServerSidePropsContext } from "next";

/**
 * `/login` — zero-UI auth entry.
 *
 * Unauthenticated hits are short-circuited server-side: we ask better-auth
 * for the Hanzo IAM authorization URL (which also mints the PKCE + state
 * cookies), forward those cookies on the response, and issue a 302 straight
 * to `hanzo.id`. There is no login form — the OAuth callback brings the user
 * back signed in.
 */
export default function Login() {
	// Never rendered: getServerSideProps always redirects.
	return null;
}

function firstParam(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

export async function getServerSideProps(context: GetServerSidePropsContext) {
	const callbackURL =
		firstParam(context.query.callbackURL) ?? "/dashboard/home";

	// Already signed in → straight to the dashboard.
	try {
		const { user } = await validateRequest(context.req);
		if (user) {
			return {
				redirect: { permanent: false, destination: callbackURL },
			};
		}
	} catch {}

	// IAM not configured (local/self-hosted without OIDC creds): fall back to
	// the credential form on `/`.
	if (!IAM_CONFIGURED) {
		return {
			redirect: { permanent: false, destination: "/" },
		};
	}

	// Ask better-auth for the IAM authorize URL. `asResponse` returns a Response
	// carrying the PKCE/state `Set-Cookie` headers we must forward to the browser.
	const response = await auth.signInWithOAuth2({
		body: {
			providerId: IAM_PROVIDER_ID,
			callbackURL,
			errorCallbackURL: "/login",
		},
		asResponse: true,
	});

	const { url } = (await response.clone().json()) as { url?: string };
	if (!url) {
		throw new Error("IAM sign-in did not return an authorization URL");
	}

	for (const cookie of response.headers.getSetCookie()) {
		context.res.appendHeader("Set-Cookie", cookie);
	}

	return {
		redirect: { permanent: false, destination: url },
	};
}
