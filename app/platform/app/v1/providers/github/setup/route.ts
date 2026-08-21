/**
 * GitHub App manifest + installation callback — GET /v1/providers/github/setup
 *
 * Where GitHub sends the browser back after a person creates the App
 * (`gh_init`) or installs it on their account (`gh_setup`). Both write a row
 * that the CI/CD delivery lane later trusts: `gh_init` mints the App's
 * credentials — including the webhook secret every delivery is verified with —
 * and `gh_setup` binds an installation id to that App.
 *
 * WHO is asking comes from the IAM session, never from the URL. GitHub echoes
 * `state` back verbatim from wherever the flow started, so anything written
 * there is a value the person who followed the link chose. The organization the
 * row belongs to and the user who owns it are read off the session instead, and
 * `gh_setup`'s target row has to be that organization's — otherwise the value
 * that decides whose builds a delivery may cause is picked by whoever opens the
 * URL.
 *
 * `state` therefore carries ONE thing: which of the two callbacks this is, and
 * for `gh_setup` which App row it is about.
 */
import { db } from "@hanzo/platform/db";
import { validateRequest } from "@hanzo/platform/lib/auth";
import { createGithub } from "@hanzo/platform/services/github";
import { eq } from "drizzle-orm";
import { Octokit } from "octokit";
import { github } from "@/server/db/schema";
import { asIncomingMessage } from "@/server/v1/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GitHub numbers its installations. Anything else keys no delivery. */
const INSTALLATION_ID = /^\d+$/;

export async function GET(req: Request) {
	const { session, user } = await validateRequest(asIncomingMessage(req));
	const organizationId = session?.activeOrganizationId;
	if (!user || !organizationId) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const params = new URL(req.url).searchParams;
	const code = params.get("code");
	const state = params.get("state") ?? "";
	const installationId = params.get("installation_id") ?? "";

	if (!code) {
		return Response.json({ error: "Missing code parameter" }, { status: 400 });
	}
	const [action, subject] = state.split(":");

	if (action === "gh_init") {
		const octokit = new Octokit({});
		const { data } = await octokit.request(
			"POST /app-manifests/{code}/conversions",
			{ code },
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
			organizationId,
			user.id,
		);
	} else if (action === "gh_setup") {
		if (!INSTALLATION_ID.test(installationId)) {
			return Response.json(
				{ error: "installation_id is a number" },
				{ status: 400 },
			);
		}
		const row = await db.query.github.findFirst({
			where: eq(github.githubId, subject ?? ""),
			with: { gitProvider: true },
		});
		// One answer for "no such App" and "not yours": which of the two it is is
		// itself a fact about somebody else's row.
		if (!row || row.gitProvider?.organizationId !== organizationId) {
			return Response.json({ error: "No such App" }, { status: 404 });
		}
		await db
			.update(github)
			.set({ githubInstallationId: installationId })
			.where(eq(github.githubId, row.githubId));
	}

	return Response.redirect(
		new URL("/dashboard/settings/git-providers", req.url),
		307,
	);
}
