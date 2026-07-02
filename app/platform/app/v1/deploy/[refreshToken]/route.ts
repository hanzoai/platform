/**
 * Application deploy webhook — POST /v1/deploy/{refreshToken}
 *
 * Git/registry providers POST here to trigger an auto-deploy of the platform
 * application whose refreshToken matches the path. Payload parsing lives in the
 * single home `server/deploy/webhook.ts`; this route folds the request into that
 * `(headers, body)` contract, runs the source-type gating, and enqueues.
 */
import { IS_CLOUD } from "@hanzo/platform/constants";
import { shouldDeploy } from "@hanzo/platform/utils/watch-paths/should-deploy";
import { db } from "@hanzo/platform/db";
import { eq } from "drizzle-orm";
import { applications } from "@/server/db/schema";
import {
	extractBranchName,
	extractCommitMessage,
	extractCommittedPaths,
	extractHash,
	extractImageName,
	extractImageNameFromRequest,
	extractImageTag,
	extractImageTagFromRequest,
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
		const application = await db.query.applications.findFirst({
			where: eq(applications.refreshToken, refreshToken),
			with: {
				environment: {
					with: {
						project: true,
					},
				},
				bitbucket: true,
			},
		});

		if (!application) {
			return Response.json({ message: "Application Not Found" }, { status: 404 });
		}
		if (!application?.autoDeploy) {
			return Response.json(
				{ message: "Automatic deployments are disabled for this application" },
				{ status: 400 },
			);
		}

		const deploymentTitle = extractCommitMessage(headers, body);
		const deploymentHash = extractHash(headers, body);
		const sourceType = application.sourceType;

		if (sourceType === "docker") {
			const applicationImageName = extractImageName(application.dockerImage);
			const applicationDockerTag = extractImageTag(application.dockerImage);

			const webhookImageName = extractImageNameFromRequest(headers, body);
			const webhookDockerTag = extractImageTagFromRequest(headers, body);

			if (!applicationImageName) {
				return Response.json(
					{ message: "Application Docker Image Name Not Found" },
					{ status: 301 },
				);
			}

			// If webhook provides image information, validate it matches the configured image
			// If webhook doesn't provide image information, fall back to using the configured image (backward compatibility)
			if (webhookImageName) {
				// Validate image name matches
				if (webhookImageName !== applicationImageName) {
					return Response.json(
						{
							message: `Application Image Name (${applicationImageName}) doesn't match request event payload Image Name (${webhookImageName}).`,
						},
						{ status: 301 },
					);
				}

				if (!applicationDockerTag) {
					return Response.json(
						{ message: "Application Docker Tag Not Found" },
						{ status: 301 },
					);
				}

				if (webhookDockerTag) {
					if (webhookDockerTag !== applicationDockerTag) {
						return Response.json(
							{
								message: `Application Image Tag (${applicationDockerTag}) doesn't match request event payload Image Tag (${webhookDockerTag}).`,
							},
							{ status: 301 },
						);
					}
				}
			}
			// If webhook doesn't provide image info, we'll use the configured image (old behavior)
		} else if (sourceType === "github") {
			const normalizedCommits = body?.commits?.flatMap(
				(commit: any) => commit.modified,
			);

			const shouldDeployPaths = shouldDeploy(
				application.watchPaths,
				normalizedCommits,
			);

			if (!shouldDeployPaths) {
				return Response.json({ message: "Watch Paths Not Match" }, { status: 301 });
			}

			const branchName = extractBranchName(headers, body);
			if (!branchName || branchName !== application.branch) {
				return Response.json({ message: "Branch Not Match" }, { status: 301 });
			}
		} else if (sourceType === "git") {
			const branchName = extractBranchName(headers, body);

			if (!branchName || branchName !== application.customGitBranch) {
				return Response.json({ message: "Branch Not Match" }, { status: 301 });
			}

			const provider = getProviderByHeader(headers);
			let normalizedCommits: string[] = [];

			if (
				provider === "github" ||
				provider === "gitlab" ||
				provider === "gitea" ||
				provider === "soft-serve"
			) {
				normalizedCommits = body?.commits?.flatMap(
					(commit: any) => commit.modified,
				);
			}

			const shouldDeployPaths = shouldDeploy(
				application.watchPaths,
				normalizedCommits,
			);

			if (!shouldDeployPaths) {
				return Response.json({ message: "Watch Paths Not Match" }, { status: 301 });
			}
		} else if (sourceType === "gitlab") {
			const branchName = extractBranchName(headers, body);

			const normalizedCommits = body?.commits?.flatMap(
				(commit: any) => commit.modified,
			);

			const shouldDeployPaths = shouldDeploy(
				application.watchPaths,
				normalizedCommits,
			);

			if (!shouldDeployPaths) {
				return Response.json({ message: "Watch Paths Not Match" }, { status: 301 });
			}

			if (!branchName || branchName !== application.gitlabBranch) {
				return Response.json({ message: "Branch Not Match" }, { status: 301 });
			}
		} else if (sourceType === "bitbucket") {
			const branchName = extractBranchName(headers, body);

			if (!branchName || branchName !== application.bitbucketBranch) {
				return Response.json({ message: "Branch Not Match" }, { status: 301 });
			}

			const committedPaths = await extractCommittedPaths(
				body,
				application.bitbucket,
				application.bitbucketRepositorySlug ||
					application.bitbucketRepository ||
					"",
			);

			const shouldDeployPaths = shouldDeploy(
				application.watchPaths,
				committedPaths,
			);

			if (!shouldDeployPaths) {
				return Response.json({ message: "Watch Paths Not Match" }, { status: 301 });
			}
		} else if (sourceType === "gitea") {
			const branchName = extractBranchName(headers, body);

			const normalizedCommits = body?.commits?.flatMap(
				(commit: any) => commit.modified,
			);

			const shouldDeployPaths = shouldDeploy(
				application.watchPaths,
				normalizedCommits,
			);

			if (!shouldDeployPaths) {
				return Response.json({ message: "Watch Paths Not Match" }, { status: 301 });
			}

			if (!branchName || branchName !== application.giteaBranch) {
				return Response.json({ message: "Branch Not Match" }, { status: 301 });
			}
		}

		try {
			const jobData: DeploymentJob = {
				applicationId: application.applicationId as string,
				titleLog: deploymentTitle,
				...(deploymentHash && { descriptionLog: `Hash: ${deploymentHash}` }),
				type: "deploy",
				applicationType: "application",
				server: !!application.serverId,
			};

			if (IS_CLOUD && application.serverId) {
				jobData.serverId = application.serverId;
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
			logWebhookError("Error deploying Application:", error);
			return Response.json(
				{ message: "Error deploying Application" },
				{ status: 400 },
			);
		}

		return Response.json({ message: "Application deployed successfully" });
	} catch (error) {
		logWebhookError("Error deploying Application:", error);
		return Response.json(
			{ message: "Error deploying Application" },
			{ status: 400 },
		);
	}
}
