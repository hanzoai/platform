/**
 * Compose deploy webhook — POST /v1/deploy/compose/{refreshToken}
 *
 * Same contract as /v1/deploy/{refreshToken} but for compose stacks. Payload
 * parsing is shared from `server/deploy/webhook.ts`.
 */
import { IS_CLOUD } from "@hanzo/platform/constants";
import { db } from "@hanzo/platform/db";
import { shouldDeploy } from "@hanzo/platform/utils/watch-paths/should-deploy";
import { eq } from "drizzle-orm";
import { compose } from "@/server/db/schema";
import {
	extractBranchName,
	extractCommitMessage,
	extractCommittedPaths,
	extractHash,
	foldHeaders,
	getProviderByHeader,
	logWebhookError,
} from "@/server/deploy/webhook";
import type { DeploymentJob } from "@/server/queues/queue-types";
import { myQueue } from "@/server/queues/queueSetup";
import { deploy } from "@/server/utils/deploy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
	req: Request,
	ctx: { params: Promise<{ refreshToken: string }> },
) {
	const { refreshToken } = await ctx.params;
	const headers = foldHeaders(req);
	const body = (await req.json().catch(() => ({}))) as any;
	try {
		if (headers["x-github-event"] === "ping") {
			return Response.json({ message: "Ping received, webhook is active" });
		}
		const composeResult = await db.query.compose.findFirst({
			where: eq(compose.refreshToken, refreshToken),
			with: {
				environment: {
					with: {
						project: true,
					},
				},
				bitbucket: true,
			},
		});

		if (!composeResult) {
			return Response.json({ message: "Compose Not Found" }, { status: 404 });
		}
		if (!composeResult?.autoDeploy) {
			return Response.json(
				{ message: "Automatic deployments are disabled for this compose" },
				{ status: 400 },
			);
		}

		const deploymentTitle = extractCommitMessage(headers, body);
		const deploymentHash = extractHash(headers, body);
		const sourceType = composeResult.sourceType;

		if (sourceType === "github") {
			const branchName = extractBranchName(headers, body);
			const normalizedCommits = body?.commits?.flatMap(
				(commit: any) => commit.modified,
			);

			const shouldDeployPaths = shouldDeploy(
				composeResult.watchPaths,
				normalizedCommits,
			);

			if (!shouldDeployPaths) {
				return Response.json(
					{ message: "Watch Paths Not Match" },
					{ status: 301 },
				);
			}

			if (!branchName || branchName !== composeResult.branch) {
				return Response.json({ message: "Branch Not Match" }, { status: 301 });
			}
		} else if (sourceType === "gitlab") {
			const branchName = extractBranchName(headers, body);
			const normalizedCommits = body?.commits?.flatMap(
				(commit: any) => commit.modified,
			);

			const shouldDeployPaths = shouldDeploy(
				composeResult.watchPaths,
				normalizedCommits,
			);

			if (!shouldDeployPaths) {
				return Response.json(
					{ message: "Watch Paths Not Match" },
					{ status: 301 },
				);
			}
			if (!branchName || branchName !== composeResult.gitlabBranch) {
				return Response.json({ message: "Branch Not Match" }, { status: 301 });
			}
		} else if (sourceType === "bitbucket") {
			const branchName = extractBranchName(headers, body);
			if (!branchName || branchName !== composeResult.bitbucketBranch) {
				return Response.json({ message: "Branch Not Match" }, { status: 301 });
			}

			const committedPaths = await extractCommittedPaths(
				body,
				composeResult.bitbucket,
				composeResult.bitbucketRepositorySlug ||
					composeResult.bitbucketRepository ||
					"",
			);

			const shouldDeployPaths = shouldDeploy(
				composeResult.watchPaths,
				committedPaths,
			);

			if (!shouldDeployPaths) {
				return Response.json(
					{ message: "Watch Paths Not Match" },
					{ status: 301 },
				);
			}
		} else if (sourceType === "git") {
			const branchName = extractBranchName(headers, body);
			if (!branchName || branchName !== composeResult.customGitBranch) {
				return Response.json({ message: "Branch Not Match" }, { status: 301 });
			}
			const provider = getProviderByHeader(headers);
			let normalizedCommits: string[] = [];

			if (
				provider === "github" ||
				provider === "gitlab" ||
				provider === "gitea"
			) {
				normalizedCommits = body?.commits?.flatMap(
					(commit: any) => commit.modified,
				);
			}

			const shouldDeployPaths = shouldDeploy(
				composeResult.watchPaths,
				normalizedCommits,
			);

			if (!shouldDeployPaths) {
				return Response.json(
					{ message: "Watch Paths Not Match" },
					{ status: 301 },
				);
			}
		} else if (sourceType === "gitea") {
			const branchName = extractBranchName(headers, body);

			const normalizedCommits = body?.commits?.flatMap(
				(commit: any) => commit.modified,
			);

			const shouldDeployPaths = shouldDeploy(
				composeResult.watchPaths,
				normalizedCommits,
			);

			if (!shouldDeployPaths) {
				return Response.json(
					{ message: "Watch Paths Not Match" },
					{ status: 301 },
				);
			}

			if (!branchName || branchName !== composeResult.giteaBranch) {
				return Response.json({ message: "Branch Not Match" }, { status: 301 });
			}
		}

		try {
			const jobData: DeploymentJob = {
				composeId: composeResult.composeId as string,
				titleLog: deploymentTitle,
				type: "deploy",
				applicationType: "compose",
				descriptionLog: `Hash: ${deploymentHash}`,
				server: !!composeResult.serverId,
			};

			if (IS_CLOUD && composeResult.serverId) {
				jobData.serverId = composeResult.serverId;
				deploy(jobData).catch((error) => {
					console.error("Background deployment failed:", error);
				});
			} else {
				await myQueue.add(
					"deployments",
					{ ...jobData },
					{
						removeOnComplete: true,
						removeOnFail: true,
					},
				);
			}
		} catch (error) {
			logWebhookError("Error deploying Compose:", error);
			return Response.json(
				{ message: "Error deploying Compose" },
				{ status: 400 },
			);
		}

		return Response.json({ message: "Compose deployed successfully" });
	} catch (error) {
		logWebhookError("Error deploying Compose:", error);
		return Response.json(
			{ message: "Error deploying Compose" },
			{ status: 400 },
		);
	}
}
