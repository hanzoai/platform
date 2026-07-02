import { findGitea, redirectWithError } from "@/server/providers/gitea-helper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	try {
		const giteaId = new URL(req.url).searchParams.get("giteaId");

		if (!giteaId) {
			return Response.json({ error: "Invalid Gitea provider ID" }, { status: 400 });
		}

		const gitea = await findGitea(giteaId);
		if (!gitea || !gitea.clientId || !gitea.redirectUri) {
			return redirectWithError(req, "Incomplete OAuth configuration");
		}

		// Generate the Gitea authorization URL
		const authorizationUrl = new URL(`${gitea.giteaUrl}/login/oauth/authorize`);
		authorizationUrl.searchParams.append("client_id", gitea.clientId as string);
		authorizationUrl.searchParams.append("response_type", "code");
		authorizationUrl.searchParams.append(
			"redirect_uri",
			gitea.redirectUri as string,
		);
		authorizationUrl.searchParams.append("scope", "read:user repo");
		authorizationUrl.searchParams.append("state", giteaId);

		// Redirect user to Gitea authorization URL
		return Response.redirect(authorizationUrl.toString(), 307);
	} catch (error) {
		console.error("Error initiating Gitea OAuth flow:", error);
		return Response.json({ error: "Internal server error" }, { status: 500 });
	}
}
