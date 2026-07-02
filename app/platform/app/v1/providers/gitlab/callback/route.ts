import { findGitlabById, updateGitlab } from "@hanzo/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const params = new URL(req.url).searchParams;
	const code = params.get("code");
	const gitlabId = params.get("gitlabId");

	if (!code) {
		return Response.json({ error: "Missing or invalid code" }, { status: 400 });
	}

	const gitlab = await findGitlabById(gitlabId as string);
	// Use internal URL for token exchange when GitLab is on same instance as Hanzo Platform
	const baseUrl = gitlab.gitlabInternalUrl || gitlab.gitlabUrl;
	const gitlabUrl = new URL(baseUrl);

	const headers: HeadersInit = {
		"Content-Type": "application/x-www-form-urlencoded",
	};

	// In case of basic auth being present in the URL, we need to remove it from the URL
	// and add it to the Authorization header.
	if (gitlabUrl.username && gitlabUrl.password) {
		headers.Authorization = `Basic ${Buffer.from(`${gitlabUrl.username}:${gitlabUrl.password}`).toString("base64")}`;
	}

	const url =
		gitlabUrl.username && gitlabUrl.password
			? new URL(gitlabUrl, {
					...gitlabUrl,
					username: "",
					password: "",
				}).toString()
			: gitlabUrl.toString();

	const response = await fetch(`${url}/oauth/token`, {
		method: "POST",
		headers,
		body: new URLSearchParams({
			client_id: gitlab.applicationId as string,
			client_secret: gitlab.secret as string,
			code,
			grant_type: "authorization_code",
			redirect_uri: `${gitlab.redirectUri}?gitlabId=${gitlabId}`,
		}),
	});

	const result = await response.json();

	if (!result.access_token || !result.refresh_token) {
		return Response.json({ error: "Missing or invalid code" }, { status: 400 });
	}

	const expiresAt = Math.floor(Date.now() / 1000) + result.expires_in;
	await updateGitlab(gitlab.gitlabId, {
		accessToken: result.access_token,
		refreshToken: result.refresh_token,
		expiresAt,
	});

	return Response.redirect(
		new URL("/dashboard/settings/git-providers", req.url),
		307,
	);
}
