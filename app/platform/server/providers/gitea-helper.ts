/**
 * Gitea OAuth helpers shared by the /v1/providers/gitea/{authorize,callback}
 * route handlers. Not a route itself (no route.ts) — a plain module.
 */
import { findGiteaById } from "@hanzo/platform/services/gitea";

export interface Gitea {
	giteaId: string;
	gitProviderId: string;
	redirectUri: string | null;
	accessToken: string | null;
	refreshToken: string | null;
	expiresAt: number | null;
	giteaUrl: string;
	giteaInternalUrl: string | null;
	clientId: string | null;
	clientSecret: string | null;
	organizationName?: string;
	gitProvider: {
		name: string;
		gitProviderId: string;
		providerType: "github" | "gitlab" | "bitbucket" | "gitea";
		createdAt: string;
		organizationId: string;
	};
}

export const findGitea = async (giteaId: string): Promise<Gitea | null> => {
	try {
		const gitea = await findGiteaById(giteaId);
		return gitea;
	} catch (findError) {
		console.error("Error finding Gitea provider:", findError);
		return null;
	}
};

/** 307 redirect back to the git-providers settings page with an error query. */
export const redirectWithError = (req: Request, error: string): Response => {
	const location = new URL(
		`/dashboard/settings/git-providers?error=${encodeURIComponent(error)}`,
		req.url,
	);
	return Response.redirect(location, 307);
};
