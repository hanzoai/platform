import { createGithub } from "@hanzo/platform/services/github";
import { db } from "@hanzo/platform/db";
import { eq } from "drizzle-orm";
import { Octokit } from "octokit";
import { github } from "@/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const params = new URL(req.url).searchParams;
	const code = params.get("code");
	const state = params.get("state") ?? "";
	const installation_id = params.get("installation_id") ?? "";

	if (!code) {
		return Response.json({ error: "Missing code parameter" }, { status: 400 });
	}
	const [action, ...rest] = state.split(":");
	// For gh_init: rest[0] = organizationId, rest[1] = userId
	// For gh_setup: rest[0] = githubProviderId

	if (action === "gh_init") {
		const organizationId = rest[0];
		const userId = rest[1] || params.get("userId") || "";

		if (!userId) {
			return Response.json({ error: "Missing userId parameter" }, { status: 400 });
		}

		const octokit = new Octokit({});
		const { data } = await octokit.request(
			"POST /app-manifests/{code}/conversions",
			{
				code,
			},
		);

		await createGithub(
			{
				name: data.name,
				githubAppName: data.html_url,
				githubAppId: data.id,
				githubClientId: data.client_id,
				githubClientSecret: data.client_secret,
				githubWebhookSecret: data.webhook_secret,
				githubPrivateKey: data.pem,
			},
			organizationId as string,
			userId,
		);
	} else if (action === "gh_setup") {
		await db
			.update(github)
			.set({
				githubInstallationId: installation_id,
			})
			.where(eq(github.githubId, rest[0] as string))
			.returning();
	}

	return Response.redirect(
		new URL("/dashboard/settings/git-providers", req.url),
		307,
	);
}
