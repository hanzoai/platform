import { updateGitea } from "@hanzo/platform";
import {
	findGitea,
	type Gitea,
	redirectWithError,
} from "@/server/providers/gitea-helper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Helper to parse the state parameter
const parseState = (state: string): string | null => {
	try {
		const stateObj =
			state.startsWith("{") && state.endsWith("}") ? JSON.parse(state) : {};
		return stateObj.giteaId || state || null;
	} catch {
		return null;
	}
};

// Helper to fetch access token from Gitea
const fetchAccessToken = async (gitea: Gitea, code: string) => {
	// Use internal URL for token exchange when Gitea is on same instance as Hanzo Platform
	const baseUrl = gitea.giteaInternalUrl || gitea.giteaUrl;
	const response = await fetch(`${baseUrl}/login/oauth/access_token`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: new URLSearchParams({
			client_id: gitea.clientId as string,
			client_secret: gitea.clientSecret as string,
			code,
			grant_type: "authorization_code",
			redirect_uri: gitea.redirectUri || "",
		}),
	});

	const responseText = await response.text();
	return response.ok
		? JSON.parse(responseText)
		: { error: "Token exchange failed", responseText };
};

export async function GET(req: Request) {
	const params = new URL(req.url).searchParams;
	const code = params.get("code");
	const state = params.get("state");

	if (!code || !state) {
		return redirectWithError(
			req,
			"Invalid authorization code or state parameter",
		);
	}

	const giteaId = parseState(state);
	if (!giteaId) return redirectWithError(req, "Invalid state format");

	const gitea = await findGitea(giteaId);
	if (!gitea) return redirectWithError(req, "Failed to find Gitea provider");

	// Fetch the access token from Gitea
	const result = await fetchAccessToken(gitea, code);

	if (result.error) {
		console.error("Token exchange failed:", result);
		return redirectWithError(req, result.error);
	}

	if (!result.access_token) {
		console.error("Missing access token:", result);
		return redirectWithError(req, "No access token received");
	}

	const expiresAt = result.expires_in
		? Math.floor(Date.now() / 1000) + result.expires_in
		: null;

	try {
		await updateGitea(gitea.giteaId, {
			accessToken: result.access_token,
			refreshToken: result.refresh_token,
			expiresAt,
			...(result.organizationName
				? { organizationName: result.organizationName }
				: {}),
		});

		return Response.redirect(
			new URL("/dashboard/settings/git-providers?connected=true", req.url),
			307,
		);
	} catch (updateError) {
		console.error("Failed to update Gitea provider:", updateError);
		return redirectWithError(req, "Failed to store access token");
	}
}
