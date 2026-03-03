import { db } from "@hanzo/platform/db";
import {
	type apiCreateGithub,
	gitProvider,
	github,
} from "@hanzo/platform/db/schema";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { authGithub } from "../utils/providers/github";

export type Github = typeof github.$inferSelect;

export const getIssueComment = (
	appName: string,
	status: "initializing" | "building" | "success" | "error",
	previewDomain: string,
) => {
	const statusEmoji = {
		initializing: "🔄",
		building: "🔨",
		success: "✅",
		error: "❌",
	};

	const statusMessages = {
		initializing: "Deployment is being initialized...",
		building: "Building your application...",
		success: `Your preview deployment is ready!`,
		error: "There was an error with the deployment.",
	};

	return `
**Application:** ${appName}
**Status:** ${statusEmoji[status]} ${statusMessages[status]}
**Preview URL:** ${status === "success" ? previewDomain : "Not available yet"}
${status === "success" ? `\n[View Preview](${previewDomain})` : ""}
`;
};

export const createPreviewDeploymentComment = async (
	github: Github,
	owner: string,
	repo: string,
	pullRequestNumber: number,
	comment: string,
) => {
	const octokit = authGithub(github);

	return await octokit.rest.issues.createComment({
		owner,
		repo,
		issue_number: pullRequestNumber,
		body: comment,
	});
};

export const issueCommentExists = async (
	github: Github,
	owner: string,
	repo: string,
	pullRequestNumber: number,
	searchString: string,
) => {
	const octokit = authGithub(github);

	const comments = await octokit.rest.issues.listComments({
		owner,
		repo,
		issue_number: pullRequestNumber,
	});

	return comments.data.some((comment) => comment.body?.includes(searchString));
};

export const updateIssueComment = async (
	github: Github,
	owner: string,
	repo: string,
	commentId: number,
	body: string,
) => {
	const octokit = authGithub(github);

	return await octokit.rest.issues.updateComment({
		owner,
		repo,
		comment_id: commentId,
		body,
	});
};

export const createGithub = async (
	input: typeof apiCreateGithub._type,
	organizationId: string,
) => {
	return await db.transaction(async (tx) => {
		const newGitProvider = await tx
			.insert(gitProvider)
			.values({
				providerType: "github",
				organizationId: organizationId,
				name: input.name,
			})
			.returning()
			.then((response) => response[0]);

		if (!newGitProvider) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Error creating the Git provider",
			});
		}

		return await tx
			.insert(github)
			.values({
				...input,
				gitProviderId: newGitProvider?.gitProviderId,
			})
			.returning()
			.then((response) => response[0]);
	});
};

export const findGithubById = async (githubId: string) => {
	const githubProviderResult = await db.query.github.findFirst({
		where: eq(github.githubId, githubId),
		with: {
			gitProvider: true,
		},
	});

	if (!githubProviderResult) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Github Provider not found",
		});
	}

	return githubProviderResult;
};

export const updateGithub = async (
	githubId: string,
	input: Partial<Github>,
) => {
	return await db
		.update(github)
		.set({
			...input,
		})
		.where(eq(github.githubId, githubId))
		.returning()
		.then((response) => response[0]);
};
