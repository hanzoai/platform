import { findGiteaById } from "@hanzo/platform";
import type { NextApiRequest, NextApiResponse } from "next";

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

export const redirectWithError = (res: NextApiResponse, error: string) => {
	return res.redirect(
		307,
		`/dashboard/settings/git-providers?error=${encodeURIComponent(error)}`,
	);
};

// Default export required by Next.js API route convention
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
	return res.status(404).json({ error: "This is a helper module, not an API endpoint" });
}
