import { createPrivateKey } from "node:crypto";
import { join } from "node:path";
import { paths } from "@hanzo/platform/constants";
import type { apiFindGithubBranches } from "@hanzo/platform/db/schema";
import { findGithubById, type Github } from "@hanzo/platform/services/github";
import type { InferResultType } from "@hanzo/platform/types/with";
import { createAppAuth } from "@octokit/auth-app";
import { TRPCError } from "@trpc/server";
import { Octokit } from "octokit";
import type { z } from "zod";

export const authGithub = (githubProvider: Github): Octokit => {
	if (!haveGithubRequirements(githubProvider)) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Github Account not configured correctly",
		});
	}

	const octokit: Octokit = new Octokit({
		authStrategy: createAppAuth,
		auth: {
			appId: githubProvider?.githubAppId || 0,
			privateKey: githubProvider?.githubPrivateKey || "",
			installationId: githubProvider?.githubInstallationId,
		},
	});

	return octokit;
};

export const getGithubToken = async (
	octokit: ReturnType<typeof authGithub>,
) => {
	const installation = (await octokit.auth({
		type: "installation",
	})) as {
		token: string;
	};

	return installation.token;
};

/**
 * Octokit authenticated as the platform's OWN GitHub App installation, built
 * from the App credentials in the environment (`GITHUB_APP_ID` /
 * `GITHUB_APP_PRIVATE_KEY` / `GITHUB_APP_INSTALLATION_ID`, synced from KMS
 * `hanzo/platform`). This is the App-token path for the control plane's
 * "App-free" GitHub readers — release metadata and App-free repo-config reads —
 * that previously authenticated with a single rate-limited PAT (`GH_TOKEN`).
 *
 * `createAppAuth` mints and transparently refreshes a short-lived installation
 * token (App JWT → `POST /app/installations/{id}/access_tokens`) per request,
 * raising the shared read limit to the installation's own 5000/hr and scoping
 * access to exactly the installation's repos.
 *
 * Fallbacks, in order, so every environment still runs:
 *   1. App installation token  (in-cluster: creds present)
 *   2. `GH_TOKEN` PAT          (legacy / transitional)
 *   3. unauthenticated         (dev box with neither — low anonymous limit)
 */
export const appEnvOctokit = (): Octokit => {
	const appId = process.env.GITHUB_APP_ID;
	const privateKey = pkcs8(process.env.GITHUB_APP_PRIVATE_KEY);
	const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
	if (appId && privateKey && installationId) {
		return new Octokit({
			authStrategy: createAppAuth,
			auth: {
				appId: Number(appId),
				privateKey,
				installationId: Number(installationId),
			},
		});
	}
	const token = process.env.GH_TOKEN;
	return token ? new Octokit({ auth: token }) : new Octokit();
};

/**
 * An RSA private key in the one encoding the JWT signer accepts.
 *
 * GitHub hands out App keys as PKCS#1 (`BEGIN RSA PRIVATE KEY`);
 * `universal-github-app-jwt`, under `@octokit/auth-app`, accepts only PKCS#8
 * (`BEGIN PRIVATE KEY`) and throws "Private Key is in PKCS#1 format, but only
 * PKCS#8 is supported" on EVERY request. Not at construction — at request time,
 * so the App path looks configured and then fails per call, which is how the
 * apps board's Latest column read empty for every row while the credentials
 * were plainly present.
 *
 * The two encodings are the same key, so this converts rather than asks anyone
 * to re-issue or re-store one: normalize at the boundary where the key enters
 * the process, and no caller — or KMS entry — has to know which form it holds.
 * A PKCS#8 key passes through untouched, and an unparseable value is returned
 * as-is so the failure stays where it belongs (the auth library's own error),
 * never swallowed here.
 */
export const pkcs8 = (key: string | undefined): string | undefined => {
	if (!key?.includes("BEGIN RSA PRIVATE KEY")) return key;
	try {
		return createPrivateKey(key)
			.export({ type: "pkcs8", format: "pem" })
			.toString();
	} catch {
		return key;
	}
};

/**
 * Check if a GitHub user has write/admin permissions on a repository
 * This is used to validate PR authors before allowing preview deployments
 */
export const checkUserRepositoryPermissions = async (
	githubProvider: Github,
	owner: string,
	repo: string,
	username: string,
): Promise<{ hasWriteAccess: boolean; permission: string | null }> => {
	try {
		const octokit = authGithub(githubProvider);

		// Check if user is a collaborator with write permissions
		const { data: permission } =
			await octokit.rest.repos.getCollaboratorPermissionLevel({
				owner,
				repo,
				username,
			});

		// Allow only users with 'write', 'admin', or 'maintain' permissions
		// Currently exists Read, Triage, Write, Maintain, Admin
		const allowedPermissions = ["write", "admin", "maintain"];
		const hasWriteAccess = allowedPermissions.includes(permission.permission);

		return {
			hasWriteAccess,
			permission: permission.permission,
		};
	} catch (error) {
		// If user is not a collaborator, GitHub API returns 404
		console.warn(
			`User ${username} is not a collaborator of ${owner}/${repo}:`,
			error,
		);
		return {
			hasWriteAccess: false,
			permission: null,
		};
	}
};

export const haveGithubRequirements = (githubProvider: Github) => {
	return !!(
		githubProvider?.githubAppId &&
		githubProvider?.githubPrivateKey &&
		githubProvider?.githubInstallationId
	);
};

const getErrorCloneRequirements = (entity: {
	repository?: string | null;
	owner?: string | null;
	branch?: string | null;
}) => {
	const reasons: string[] = [];
	const { repository, owner, branch } = entity;

	if (!repository) reasons.push("1. Repository not assigned.");
	if (!owner) reasons.push("2. Owner not specified.");
	if (!branch) reasons.push("3. Branch not defined.");

	return reasons;
};

export type ApplicationWithGithub = InferResultType<
	"applications",
	{ github: true }
>;

export type ComposeWithGithub = InferResultType<"compose", { github: true }>;

interface CloneGithubRepository {
	appName: string;
	owner: string | null;
	branch: string | null;
	githubId: string | null;
	repository: string | null;
	type?: "application" | "compose";
	enableSubmodules: boolean;
	serverId: string | null;
	outputPathOverride?: string;
}
export const cloneGithubRepository = async ({
	type = "application",
	...entity
}: CloneGithubRepository) => {
	let command = "set -e;";
	const isCompose = type === "compose";
	const {
		appName,
		repository,
		owner,
		branch,
		githubId,
		enableSubmodules,
		serverId,
		outputPathOverride,
	} = entity;
	const { APPLICATIONS_PATH, COMPOSE_PATH } = paths(!!serverId);

	if (!githubId) {
		command += `echo "Error: ❌ Github Provider not found"; exit 1;`;

		return command;
	}

	const requirements = getErrorCloneRequirements(entity);

	// Check if requirements are met
	if (requirements.length > 0) {
		command += `echo "GitHub Repository configuration failed for application: ${appName}"; echo "Reasons:"; echo "${requirements.join("\n")}"; exit 1;`;
		return command;
	}

	const githubProvider = await findGithubById(githubId);
	const basePath = isCompose ? COMPOSE_PATH : APPLICATIONS_PATH;
	const outputPath = outputPathOverride ?? join(basePath, appName, "code");
	const octokit = authGithub(githubProvider);
	const token = await getGithubToken(octokit);
	const repoclone = `github.com/${owner}/${repository}.git`;
	command += `rm -rf ${outputPath};`;
	command += `mkdir -p ${outputPath};`;
	const cloneUrl = `https://oauth2:${token}@${repoclone}`;

	command += `echo "Cloning Repo ${repoclone} to ${outputPath}: ✅";`;
	command += `git clone --branch ${branch} --depth 1 ${enableSubmodules ? "--recurse-submodules" : ""} ${cloneUrl} ${outputPath} --progress;`;

	return command;
};

export const getGithubRepositories = async (githubId?: string) => {
	if (!githubId) {
		return [];
	}

	const githubProvider = await findGithubById(githubId);

	const octokit = new Octokit({
		authStrategy: createAppAuth,
		auth: {
			appId: githubProvider.githubAppId,
			privateKey: githubProvider.githubPrivateKey,
			installationId: githubProvider.githubInstallationId,
		},
	});

	const repositories = (await octokit.paginate(
		octokit.rest.apps.listReposAccessibleToInstallation,
	)) as unknown as Awaited<
		ReturnType<typeof octokit.rest.apps.listReposAccessibleToInstallation>
	>["data"]["repositories"];

	return repositories;
};

export const getGithubBranches = async (
	input: z.infer<typeof apiFindGithubBranches>,
) => {
	if (!input.githubId) {
		return [];
	}
	const githubProvider = await findGithubById(input.githubId);

	const octokit = new Octokit({
		authStrategy: createAppAuth,
		auth: {
			appId: githubProvider.githubAppId,
			privateKey: githubProvider.githubPrivateKey,
			installationId: githubProvider.githubInstallationId,
		},
	});

	const branches = (await octokit.paginate(octokit.rest.repos.listBranches, {
		owner: input.owner,
		repo: input.repo,
	})) as unknown as Awaited<
		ReturnType<typeof octokit.rest.repos.listBranches>
	>["data"];

	return branches;
};
