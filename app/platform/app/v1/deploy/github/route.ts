/**
 * GitHub App deploy webhook — POST /v1/deploy/github
 *
 * The Dokploy GitHub-App webhook: verifies the delivery HMAC, then maps push /
 * pull_request / tag events onto the platform applications & compose stacks
 * configured to auto-deploy. Payload parsing helpers are shared from
 * `server/deploy/webhook.ts`.
 */
import { IS_CLOUD } from "@hanzo/platform/constants";
import { db } from "@hanzo/platform/db";
import {
	createSecurityBlockedComment,
	findGithubById,
} from "@hanzo/platform/services/github";
import {
	createPreviewDeployment,
	findPreviewDeploymentByApplicationId,
	findPreviewDeploymentsByPullRequestId,
	removePreviewDeployment,
} from "@hanzo/platform/services/preview-deployment";
import { checkUserRepositoryPermissions } from "@hanzo/platform/utils/providers/github";
import { shouldDeploy } from "@hanzo/platform/utils/watch-paths/should-deploy";
import { Webhooks } from "@octokit/webhooks";
import { and, eq } from "drizzle-orm";
import { applications, compose, github } from "@/server/db/schema";
import {
	extractCommitMessage,
	extractHash,
	foldHeaders,
	logWebhookError,
} from "@/server/deploy/webhook";
import type { DeploymentJob } from "@/server/queues/queue-types";
import { myQueue } from "@/server/queues/queueSetup";
import { deploy } from "@/server/utils/deploy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const headers = foldHeaders(req);
	const signature = headers["x-hub-signature-256"] as string | undefined;
	if (!signature) {
		return Response.json({ message: "Missing signature header" }, { status: 401 });
	}

	const githubBody = (await req.json().catch(() => null)) as any;

	if (!githubBody?.installation?.id) {
		return Response.json(
			{ message: "Github Installation not found" },
			{ status: 400 },
		);
	}

	const githubResult = await db.query.github.findFirst({
		where: eq(github.githubInstallationId, githubBody.installation.id),
	});

	if (!githubResult) {
		return Response.json(
			{ message: "Github Installation not found" },
			{ status: 400 },
		);
	}

	if (!githubResult.githubWebhookSecret) {
		return Response.json(
			{ message: "Github Webhook Secret not set" },
			{ status: 400 },
		);
	}
	const webhooks = new Webhooks({
		secret: githubResult.githubWebhookSecret,
	});

	const verified = await webhooks.verify(JSON.stringify(githubBody), signature);

	if (!verified) {
		return Response.json({ message: "Unauthorized" }, { status: 401 });
	}

	if (headers["x-github-event"] === "ping") {
		return Response.json({ message: "Ping received, webhook is active" });
	}

	if (
		headers["x-github-event"] !== "push" &&
		headers["x-github-event"] !== "pull_request"
	) {
		return Response.json(
			{ message: "We only accept push events or pull_request events" },
			{ status: 400 },
		);
	}

	// skip workflow runs use keywords
	// @link https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/skipping-workflow-runs
	if (
		[
			"[skip ci]",
			"[ci skip]",
			"[no ci]",
			"[skip actions]",
			"[actions skip]",
		].find((keyword) =>
			extractCommitMessage(headers, githubBody).includes(keyword),
		)
	) {
		return Response.json({
			message: "Deployment skipped: commit message contains skip keyword",
		});
	}

	// Handle tag creation event
	if (
		headers["x-github-event"] === "push" &&
		githubBody?.ref?.startsWith("refs/tags/")
	) {
		try {
			const tagName = githubBody?.ref.replace("refs/tags/", "");
			const repository = githubBody?.repository?.name;
			const owner = githubBody?.repository?.owner?.name;
			const deploymentTitle = `Tag created: ${tagName}`;
			const deploymentHash = extractHash(headers, githubBody);

			// Find applications configured to deploy on tag
			const apps = await db.query.applications.findMany({
				where: and(
					eq(applications.sourceType, "github"),
					eq(applications.autoDeploy, true),
					eq(applications.triggerType, "tag"),
					eq(applications.repository, repository),
					eq(applications.owner, owner),
					eq(applications.githubId, githubResult.githubId),
				),
			});

			for (const app of apps) {
				const jobData: DeploymentJob = {
					applicationId: app.applicationId as string,
					titleLog: deploymentTitle,
					descriptionLog: `Hash: ${deploymentHash}`,
					type: "deploy",
					applicationType: "application",
					server: !!app.serverId,
				};

				if (IS_CLOUD && app.serverId) {
					jobData.serverId = app.serverId;
					deploy(jobData).catch((error) => {
						console.error("Background deployment failed:", error);
					});
					continue;
				}
				await myQueue.add(
					"deployments",
					{ ...jobData },
					{
						removeOnComplete: true,
						removeOnFail: true,
					},
				);
			}

			// Find compose apps configured to deploy on tag
			const composeApps = await db.query.compose.findMany({
				where: and(
					eq(compose.sourceType, "github"),
					eq(compose.autoDeploy, true),
					eq(compose.triggerType, "tag"),
					eq(compose.repository, repository),
					eq(compose.owner, owner),
					eq(compose.githubId, githubResult.githubId),
				),
			});

			for (const composeApp of composeApps) {
				const jobData: DeploymentJob = {
					composeId: composeApp.composeId as string,
					titleLog: deploymentTitle,
					type: "deploy",
					applicationType: "compose",
					descriptionLog: `Hash: ${deploymentHash}`,
					server: !!composeApp.serverId,
				};

				if (IS_CLOUD && composeApp.serverId) {
					jobData.serverId = composeApp.serverId;
					deploy(jobData).catch((error) => {
						console.error("Background deployment failed:", error);
					});
					continue;
				}

				await myQueue.add(
					"deployments",
					{ ...jobData },
					{
						removeOnComplete: true,
						removeOnFail: true,
					},
				);
			}

			const totalApps = apps.length + composeApps.length;

			if (totalApps === 0) {
				return Response.json({ message: "No apps configured to deploy on tag" });
			}

			return Response.json({
				message: `Deployed ${totalApps} apps based on tag ${tagName}`,
			});
		} catch (error) {
			logWebhookError("Error deploying applications on tag:", error);
			return Response.json(
				{ message: "Error deploying applications on tag" },
				{ status: 400 },
			);
		}
	}

	if (headers["x-github-event"] === "push") {
		try {
			const branchName = githubBody?.ref?.replace("refs/heads/", "");
			const repository = githubBody?.repository?.name;

			const deploymentTitle = extractCommitMessage(headers, githubBody);
			const deploymentHash = extractHash(headers, githubBody);
			const owner = githubBody?.repository?.owner?.name;
			const normalizedCommits = githubBody?.commits?.flatMap(
				(commit: any) => commit.modified,
			);

			const apps = await db.query.applications.findMany({
				where: and(
					eq(applications.sourceType, "github"),
					eq(applications.autoDeploy, true),
					eq(applications.triggerType, "push"),
					eq(applications.branch, branchName),
					eq(applications.repository, repository),
					eq(applications.owner, owner),
					eq(applications.githubId, githubResult.githubId),
				),
			});

			for (const app of apps) {
				const jobData: DeploymentJob = {
					applicationId: app.applicationId as string,
					titleLog: deploymentTitle,
					descriptionLog: `Hash: ${deploymentHash}`,
					type: "deploy",
					applicationType: "application",
					server: !!app.serverId,
				};

				const shouldDeployPaths = shouldDeploy(app.watchPaths, normalizedCommits);

				if (!shouldDeployPaths) {
					continue;
				}

				if (IS_CLOUD && app.serverId) {
					jobData.serverId = app.serverId;
					deploy(jobData).catch((error) => {
						console.error("Background deployment failed:", error);
					});
					continue;
				}
				await myQueue.add(
					"deployments",
					{ ...jobData },
					{
						removeOnComplete: true,
						removeOnFail: true,
					},
				);
			}

			const composeApps = await db.query.compose.findMany({
				where: and(
					eq(compose.sourceType, "github"),
					eq(compose.autoDeploy, true),
					eq(compose.triggerType, "push"),
					eq(compose.branch, branchName),
					eq(compose.repository, repository),
					eq(compose.owner, owner),
					eq(compose.githubId, githubResult.githubId),
				),
			});

			for (const composeApp of composeApps) {
				const jobData: DeploymentJob = {
					composeId: composeApp.composeId as string,
					titleLog: deploymentTitle,
					type: "deploy",
					applicationType: "compose",
					descriptionLog: `Hash: ${deploymentHash}`,
					server: !!composeApp.serverId,
				};

				const shouldDeployPaths = shouldDeploy(
					composeApp.watchPaths,
					normalizedCommits,
				);

				if (!shouldDeployPaths) {
					continue;
				}
				if (IS_CLOUD && composeApp.serverId) {
					jobData.serverId = composeApp.serverId;
					deploy(jobData).catch((error) => {
						console.error("Background deployment failed:", error);
					});
					continue;
				}

				await myQueue.add(
					"deployments",
					{ ...jobData },
					{
						removeOnComplete: true,
						removeOnFail: true,
					},
				);
			}

			const totalApps = apps.length + composeApps.length;
			const emptyApps = totalApps === 0;

			if (emptyApps) {
				return Response.json({ message: "No apps to deploy" });
			}
			return Response.json({ message: `Deployed ${totalApps} apps` });
		} catch (error) {
			logWebhookError("Error deploying Application:", error);
			return Response.json(
				{ message: "Error deploying Application" },
				{ status: 400 },
			);
		}
	} else if (headers["x-github-event"] === "pull_request") {
		const prId = githubBody?.pull_request?.id;
		const action = githubBody?.action;

		if (action === "closed") {
			const previewDeploymentResult =
				await findPreviewDeploymentsByPullRequestId(prId);

			if (previewDeploymentResult.length > 0) {
				for (const previewDeployment of previewDeploymentResult) {
					try {
						await removePreviewDeployment(previewDeployment.previewDeploymentId);
					} catch (error) {
						console.log(error);
					}
				}
			}
			return Response.json({ message: "Preview Deployment Closed" });
		}

		// opened or synchronize or reopened
		if (
			action === "opened" ||
			action === "synchronize" ||
			action === "reopened" ||
			action === "labeled" ||
			action === "unlabeled"
		) {
			const shouldCreateDeployment =
				action === "opened" ||
				action === "synchronize" ||
				action === "reopened";

			const repository = githubBody?.repository?.name;
			const deploymentHash = githubBody?.pull_request?.head?.sha;
			const branch = githubBody?.pull_request?.base?.ref;
			const owner = githubBody?.repository?.owner?.login;
			const prAuthor = githubBody?.pull_request?.user?.login;

			// Validate PR author information is present
			if (!prAuthor) {
				console.warn(
					"⚠️ SECURITY: PR author information missing in webhook payload",
				);
				return Response.json(
					{ message: "PR author information missing" },
					{ status: 400 },
				);
			}

			const apps = await db.query.applications.findMany({
				where: and(
					eq(applications.sourceType, "github"),
					eq(applications.repository, repository),
					eq(applications.branch, branch),
					eq(applications.isPreviewDeploymentsActive, true),
					eq(applications.owner, owner),
					eq(applications.githubId, githubResult.githubId),
				),
				with: {
					previewDeployments: true,
				},
			});

			// SECURITY: Check collaborator permissions per application setting
			const secureApps: typeof apps = [];
			const blockedApps: string[] = [];
			let userPermission: string | null = null;

			for (const app of apps) {
				// If the app requires collaborator permissions, verify them
				if (app.previewRequireCollaboratorPermissions !== false) {
					try {
						const githubProvider = await findGithubById(githubResult.githubId);
						const { hasWriteAccess, permission } =
							await checkUserRepositoryPermissions(
								githubProvider,
								owner,
								repository,
								prAuthor,
							);

						userPermission = permission; // Store permission for comment

						if (!hasWriteAccess) {
							console.warn(
								`🚨 SECURITY: Blocked preview deployment for ${app.name} from unauthorized user ${prAuthor} on ${owner}/${repository}. Permission: ${permission || "none"}`,
							);
							blockedApps.push(app.name);
							continue;
						}

						console.log(
							`✅ SECURITY: Preview deployment authorized for ${app.name} from user ${prAuthor} on ${owner}/${repository}. Permission: ${permission}`,
						);
					} catch (error) {
						console.error(
							`Error validating PR author permissions for ${app.name}:`,
							error,
						);
						blockedApps.push(app.name);
						continue; // Skip this app on error
					}
				} else {
					console.warn(
						`⚠️  SECURITY: Preview deployment for ${app.name} allows deployment from any PR author (security check disabled)`,
					);
				}
				secureApps.push(app);
			}

			const prBranch = githubBody?.pull_request?.head?.ref;

			const prNumber = githubBody?.pull_request?.number;
			const prTitle = githubBody?.pull_request?.title;
			const prURL = githubBody?.pull_request?.html_url;

			// Create security notification comment if any apps were blocked
			if (blockedApps.length > 0) {
				await createSecurityBlockedComment({
					owner,
					repository,
					prNumber: Number.parseInt(prNumber),
					prAuthor,
					permission: userPermission,
					githubId: githubResult.githubId,
				});
			}

			for (const app of secureApps) {
				// check for labels
				if (app?.previewLabels && app?.previewLabels?.length > 0) {
					let hasLabel = false;
					const labels = githubBody?.pull_request?.labels;
					for (const label of labels) {
						if (app?.previewLabels?.includes(label.name)) {
							hasLabel = true;
							break;
						}
					}
					if (!hasLabel) continue;
				}

				const previewLimit = app?.previewLimit || 0;
				if (app?.previewDeployments?.length > previewLimit) {
					continue;
				}
				const previewDeploymentResult =
					await findPreviewDeploymentByApplicationId(app.applicationId, prId);

				let previewDeploymentId =
					previewDeploymentResult?.previewDeploymentId || "";

				if (!previewDeploymentResult && shouldCreateDeployment) {
					const previewDeployment = await createPreviewDeployment({
						applicationId: app.applicationId as string,
						branch: prBranch,
						pullRequestId: prId,
						pullRequestNumber: prNumber,
						pullRequestTitle: prTitle,
						pullRequestURL: prURL,
					});
					previewDeploymentId = previewDeployment.previewDeploymentId;
				}

				const jobData: DeploymentJob = {
					applicationId: app.applicationId as string,
					titleLog: "Preview Deployment",
					descriptionLog: `Hash: ${deploymentHash}`,
					type: "deploy",
					applicationType: "application-preview",
					server: !!app.serverId,
					previewDeploymentId,
				};

				if (previewDeploymentId) {
					if (IS_CLOUD && app.serverId) {
						jobData.serverId = app.serverId;
						deploy(jobData).catch((error) => {
							console.error("Background deployment failed:", error);
						});
						continue;
					}
					await myQueue.add(
						"deployments",
						{ ...jobData },
						{
							removeOnComplete: true,
							removeOnFail: true,
						},
					);
				}
			}
			return Response.json({ message: "Apps Deployed" });
		}
	}

	return Response.json({ message: "No Actions matched" }, { status: 400 });
}
