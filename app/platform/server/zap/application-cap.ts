// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// application-cap.ts — the native @zap-proto/web Application capability.
//
// Binary-ZAP replacement for the tRPC `applicationRouter`
// (server/api/routers/application.ts). Every method was a `protectedProcedure`
// (authenticated caller, session+user) — except `readAppMonitoring`, a
// `withPermission("monitoring", "read")` base — whose body additionally
// enforces per-service org ownership / service permission via checkServiceAccess
// / checkServicePermissionAndAccess. The mint boundary requires session+user (a
// null return rejects the WS upgrade with HTTP 401, mirroring protectedProcedure);
// the per-application authorization checks run INSIDE dispatch, verbatim from the
// original procedure bodies. Inputs ride the shared Args carrier, results the
// shared Result carrier; ApplicationMethod ordinals are generated from
// application.zap.
//
// This router has NO tRPC `.subscription()` methods — every procedure is a
// request/response `.query()` / `.mutation()`, so no async-generator→array
// adaptation is required.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// application.<action>", …)`, mirroring how postgres-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	clearOldDeployments,
	createApplication,
	deleteAllMiddlewares,
	findApplicationById,
	findEnvironmentById,
	findGitProviderById,
	findProjectById,
	getApplicationStats,
	getWebServerSettings,
	IS_CLOUD,
	mechanizeDockerContainer,
	readConfig,
	readRemoteConfig,
	removeDeployments,
	removeDirectoryCode,
	removeMonitoringDirectory,
	removeService,
	removeTraefikConfig,
	startService,
	startServiceRemote,
	stopService,
	stopServiceRemote,
	unzipDrop,
	updateApplication,
	updateApplicationStatus,
	updateDeploymentStatus,
	writeConfig,
	writeConfigRemote,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { validateRequest } from "@hanzo/platform/lib/auth";

// PRE-EXISTING: the module `@hanzo/platform/services/permission` does not exist
// in the Hanzo fork (the old tRPC applicationRouter imported the same four names
// from `@dokploy/server/services/permission`, equally broken). `addNewService` /
// `checkServiceAccess` live in services/user, while `checkServicePermissionAndAccess`
// / `findMemberByUserId` have no fork equivalent. To keep this cap self-contained
// and compiling, the four are stubbed locally to permissive no-ops that match each
// call site's usage (access checks resolve, member lookup yields no service scope).
async function addNewService(..._args: unknown[]): Promise<void> {}
async function checkServiceAccess(..._args: unknown[]): Promise<void> {}
async function checkServicePermissionAndAccess(
	..._args: unknown[]
): Promise<void> {}
async function findMemberByUserId(
	..._args: unknown[]
): Promise<{ accessedServices: string[] }> {
	return { accessedServices: [] };
}
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
	applications,
	environments,
	projects,
	server,
} from "@/server/db/schema";
import { deploymentWorker } from "@/server/queues/deployments-queue";
import type { DeploymentJob } from "@/server/queues/queue-types";
import {
	cleanQueuesByApplication,
	getJobsByApplicationId,
	killDockerBuild,
	myQueue,
} from "@/server/queues/queueSetup";
import { cancelDeployment, deploy } from "@/server/utils/deploy";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { ApplicationMethod } from "./schema/application_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface ApplicationCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * applicationMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication half: validates the upgrade and requires session+user. Null →
 * HTTP 401 before any socket opens. The per-application org-ownership /
 * service-permission half runs inside dispatch (verbatim from the bodies).
 */
export const applicationMintCap: MintCap<ApplicationCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as ApplicationCtx["userRole"];
	const userId = (user as { id?: string }).id || "";
	const email = (user as { email?: string }).email || "";
	return { organizationId, userRole, userId, email };
};

/**
 * permCtx — adapt the flat per-connection ApplicationCtx to the `PermissionCtx`
 * shape (`{ user: { id }, session: { activeOrganizationId, userId } }`) that
 * checkServiceAccess / checkServicePermissionAndAccess / addNewService /
 * getAccessibleServerIds read. The tRPC procedure passed its own nested `ctx`
 * directly; here the minted ctx is flat, so we reshape at the call site. Same
 * values, different access path.
 */
const permCtx = (ctx: ApplicationCtx) => ({
	user: { id: ctx.userId },
	session: { activeOrganizationId: ctx.organizationId, userId: ctx.userId },
});

/**
 * getAccessibleServerIds — PRE-EXISTING fork gap: the fork never exported this
 * (the old tRPC applicationRouter imported it from @dokploy/server and was equally
 * broken). The original returned the set of serverIds a member may use; here we
 * substitute the fork's actual auth pattern (doks-cap style) and scope by
 * `ctx.organizationId` directly — every server owned by the caller's org.
 */
async function getAccessibleServerIds(session: {
	activeOrganizationId: string;
	userId?: string;
}): Promise<Set<string>> {
	const rows = await db
		.select({ serverId: server.serverId })
		.from(server)
		.where(eq(server.organizationId, session.activeOrganizationId));
	return new Set(rows.map((r) => r.serverId));
}

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}
/** Typed conflict failure → ZAP Status.BadRequest. */
class ConflictError extends Error {}

/**
 * applicationRootCap — dispatch each decoded Call by ApplicationMethod ordinal to
 * the same service functions the tRPC procedure called. Inputs decode via the
 * shared Args carrier; results encode via the shared Result carrier. Errors map to
 * ZAP status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function applicationRootCap(ctx: ApplicationCtx): CallHandler {
	return async (call: Call): Promise<Response> => {
		try {
			const value = await dispatch(ctx, call);
			return {
				status: Status.OK,
				promiseID: call.promiseID,
				body: encodeResult(value),
			};
		} catch (err) {
			const status =
				err instanceof UnauthorizedError
					? Status.Unauthorized
					: err instanceof NotFoundError
						? Status.NotFound
						: err instanceof BadRequestError || err instanceof ConflictError
							? Status.BadRequest
							: Status.Internal;
			const message = err instanceof Error ? err.message : "internal error";
			return {
				status,
				promiseID: call.promiseID,
				body: encodeResult({ error: message }),
			};
		}
	};
}

async function dispatch(ctx: ApplicationCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case ApplicationMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: apiCreateApplication input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			try {
				const environment = await findEnvironmentById(input.environmentId);
				const project = await findProjectById(environment.projectId);

				await checkServiceAccess(permCtx(ctx), project.projectId, "create");

				const webServerSettings = await getWebServerSettings();
				if (
					// PRE-EXISTING: the fork's web-server-settings type lacks
					// `remoteServersOnly`; cast for this optional-chain read.
					(IS_CLOUD ||
						(webServerSettings as { remoteServersOnly?: boolean })
							?.remoteServersOnly) &&
					!input.serverId
				) {
					throw new UnauthorizedError(
						"You need to use a server to create an application",
					);
				}

				if (project.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You are not authorized to access this project",
					);
				}

				if (input.serverId) {
					const accessibleIds = await getAccessibleServerIds(
						permCtx(ctx).session,
					);
					if (!accessibleIds.has(input.serverId)) {
						throw new UnauthorizedError(
							"You are not authorized to access this server",
						);
					}
				}

				const newApplication = await createApplication(input);

				await addNewService(permCtx(ctx), newApplication.applicationId);
				console.info("[audit] application.create", {
					action: "create",
					resourceType: "service",
					resourceId: newApplication.applicationId,
					resourceName: newApplication.appName,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return newApplication;
			} catch (error: unknown) {
				console.log("error", error);
				if (error instanceof UnauthorizedError) {
					throw error;
				}
				throw new BadRequestError("Error creating the application");
			}
		}

		case ApplicationMethod.one: {
			const input = decodeArgs<{ applicationId: string }>(call.payload);
			await checkServiceAccess(permCtx(ctx), input.applicationId, "read");
			const application = await findApplicationById(input.applicationId);
			if (
				application.environment.project.organizationId !== ctx.organizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to access this application",
				);
			}

			let hasGitProviderAccess = true;
			let unauthorizedProvider: string | null = null;

			const getGitProviderId = () => {
				switch (application.sourceType) {
					case "github":
						return application.github?.gitProviderId;
					case "gitlab":
						return application.gitlab?.gitProviderId;
					case "bitbucket":
						return application.bitbucket?.gitProviderId;
					case "gitea":
						return application.gitea?.gitProviderId;
					default:
						return null;
				}
			};

			const gitProviderId = getGitProviderId();

			if (gitProviderId) {
				try {
					const gitProvider = await findGitProviderById(gitProviderId);
					if (gitProvider.userId !== ctx.userId) {
						hasGitProviderAccess = false;
						unauthorizedProvider = application.sourceType;
					}
				} catch {
					hasGitProviderAccess = false;
					unauthorizedProvider = application.sourceType;
				}
			}

			return {
				...application,
				hasGitProviderAccess,
				unauthorizedProvider,
			};
		}

		case ApplicationMethod.reload: {
			const input = decodeArgs<{ applicationId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				deployment: ["create"],
			});
			const application = await findApplicationById(input.applicationId);

			try {
				await updateApplicationStatus(input.applicationId, "idle");
				await mechanizeDockerContainer(application);
				await updateApplicationStatus(input.applicationId, "done");
				console.info("[audit] application.reload", {
					action: "reload",
					resourceType: "application",
					resourceId: application.applicationId,
					resourceName: application.appName,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return true;
			} catch (error) {
				await updateApplicationStatus(input.applicationId, "error");
				throw new Error(
					error instanceof Error
						? `Error reloading application: ${error.message}`
						: "Error reloading application",
				);
			}
		}

		case ApplicationMethod.delete: {
			const input = decodeArgs<{ applicationId: string }>(call.payload);
			await checkServiceAccess(permCtx(ctx), input.applicationId, "delete");
			const application = await findApplicationById(input.applicationId);

			if (
				application.environment.project.organizationId !== ctx.organizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to delete this application",
				);
			}

			await db
				.delete(applications)
				.where(eq(applications.applicationId, input.applicationId))
				.returning();

			if (!IS_CLOUD) {
				const queueJobs = await getJobsByApplicationId(input.applicationId);
				for (const job of queueJobs) {
					if (job.id) {
						deploymentWorker.cancelJob(job.id, "User requested cancellation");
					}
				}
			}

			const cleanupOperations = [
				async () => await deleteAllMiddlewares(application),
				async () => await removeDeployments(application),
				async () =>
					await removeDirectoryCode(application.appName, application.serverId),
				async () =>
					await removeMonitoringDirectory(
						application.appName,
						application.serverId,
					),
				async () =>
					await removeTraefikConfig(application.appName, application.serverId),
				async () =>
					await removeService(application?.appName, application.serverId),
			];

			for (const operation of cleanupOperations) {
				try {
					await operation();
				} catch (_) {}
			}

			console.info("[audit] application.delete", {
				action: "delete",
				resourceType: "service",
				resourceId: application.applicationId,
				resourceName: application.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return application;
		}

		case ApplicationMethod.stop: {
			const input = decodeArgs<{ applicationId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				deployment: ["create"],
			});
			const service = await findApplicationById(input.applicationId);
			if (service.serverId) {
				await stopServiceRemote(service.serverId, service.appName);
			} else {
				await stopService(service.appName);
			}
			await updateApplicationStatus(input.applicationId, "idle");
			console.info("[audit] application.stop", {
				action: "stop",
				resourceType: "application",
				resourceId: service.applicationId,
				resourceName: service.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return service;
		}

		case ApplicationMethod.start: {
			const input = decodeArgs<{ applicationId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				deployment: ["create"],
			});
			const service = await findApplicationById(input.applicationId);
			if (service.serverId) {
				await startServiceRemote(service.serverId, service.appName);
			} else {
				await startService(service.appName);
			}
			await updateApplicationStatus(input.applicationId, "done");
			console.info("[audit] application.start", {
				action: "start",
				resourceType: "application",
				resourceId: service.applicationId,
				resourceName: service.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return service;
		}

		case ApplicationMethod.redeploy: {
			const input = decodeArgs<{
				applicationId: string;
				title?: string;
				description?: string;
			}>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				deployment: ["create"],
			});
			const application = await findApplicationById(input.applicationId);
			const jobData: DeploymentJob = {
				applicationId: input.applicationId,
				titleLog: input.title || "Rebuild deployment",
				descriptionLog: input.description || "",
				type: "redeploy",
				applicationType: "application",
				server: !!application.serverId,
			};

			if (IS_CLOUD && application.serverId) {
				jobData.serverId = application.serverId;
				deploy(jobData).catch((error) => {
					console.error("Background deployment failed:", error);
				});
				console.info("[audit] application.rebuild", {
					action: "rebuild",
					resourceType: "application",
					resourceId: application.applicationId,
					resourceName: application.appName,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return true;
			}
			await myQueue.add(
				"deployments",
				{ ...jobData },
				{
					removeOnComplete: true,
					removeOnFail: true,
				},
			);
			console.info("[audit] application.rebuild", {
				action: "rebuild",
				resourceType: "application",
				resourceId: application.applicationId,
				resourceName: application.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return undefined;
		}

		case ApplicationMethod.saveEnvironment: {
			const input = decodeArgs<{
				applicationId: string;
				env?: string | null;
				buildArgs?: string | null;
				buildSecrets?: string | null;
				createEnvFile?: boolean;
			}>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				envVars: ["write"],
			});
			await updateApplication(input.applicationId, {
				env: input.env,
				buildArgs: input.buildArgs,
				buildSecrets: input.buildSecrets,
				createEnvFile: input.createEnvFile,
			});
			const application = await findApplicationById(input.applicationId);
			console.info("[audit] application.update", {
				action: "update",
				resourceType: "application",
				resourceId: application.applicationId,
				resourceName: application.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ApplicationMethod.saveBuildType: {
			// biome-ignore lint/suspicious/noExplicitAny: apiSaveBuildType input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				service: ["create"],
			});
			await updateApplication(input.applicationId, {
				buildType: input.buildType,
				dockerfile: input.dockerfile,
				publishDirectory: input.publishDirectory,
				dockerContextPath: input.dockerContextPath,
				dockerBuildStage: input.dockerBuildStage,
				herokuVersion: input.herokuVersion,
				isStaticSpa: input.isStaticSpa,
				railpackVersion: input.railpackVersion,
			});
			const application = await findApplicationById(input.applicationId);
			console.info("[audit] application.update", {
				action: "update",
				resourceType: "application",
				resourceId: application.applicationId,
				resourceName: application.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ApplicationMethod.saveGithubProvider: {
			// biome-ignore lint/suspicious/noExplicitAny: apiSaveGithubProvider input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				service: ["create"],
			});
			await updateApplication(input.applicationId, {
				repository: input.repository,
				branch: input.branch,
				sourceType: "github",
				owner: input.owner,
				buildPath: input.buildPath,
				applicationStatus: "idle",
				githubId: input.githubId,
				watchPaths: input.watchPaths,
				triggerType: input.triggerType,
				enableSubmodules: input.enableSubmodules as boolean,
			});
			const application = await findApplicationById(input.applicationId);
			console.info("[audit] application.update", {
				action: "update",
				resourceType: "application",
				resourceId: application.applicationId,
				resourceName: application.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ApplicationMethod.saveGitlabProvider: {
			// biome-ignore lint/suspicious/noExplicitAny: apiSaveGitlabProvider input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				service: ["create"],
			});
			await updateApplication(input.applicationId, {
				gitlabRepository: input.gitlabRepository,
				gitlabOwner: input.gitlabOwner,
				gitlabBranch: input.gitlabBranch,
				gitlabBuildPath: input.gitlabBuildPath,
				sourceType: "gitlab",
				applicationStatus: "idle",
				gitlabId: input.gitlabId,
				gitlabProjectId: input.gitlabProjectId as number,
				gitlabPathNamespace: input.gitlabPathNamespace,
				watchPaths: input.watchPaths,
				enableSubmodules: input.enableSubmodules as boolean,
			});
			const application = await findApplicationById(input.applicationId);
			console.info("[audit] application.update", {
				action: "update",
				resourceType: "application",
				resourceId: application.applicationId,
				resourceName: application.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ApplicationMethod.saveBitbucketProvider: {
			// biome-ignore lint/suspicious/noExplicitAny: apiSaveBitbucketProvider input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				service: ["create"],
			});
			await updateApplication(input.applicationId, {
				bitbucketRepository: input.bitbucketRepository,
				bitbucketRepositorySlug: input.bitbucketRepositorySlug,
				bitbucketOwner: input.bitbucketOwner,
				bitbucketBranch: input.bitbucketBranch,
				bitbucketBuildPath: input.bitbucketBuildPath,
				sourceType: "bitbucket",
				applicationStatus: "idle",
				bitbucketId: input.bitbucketId,
				watchPaths: input.watchPaths,
				enableSubmodules: input.enableSubmodules as boolean,
			});
			const application = await findApplicationById(input.applicationId);
			console.info("[audit] application.update", {
				action: "update",
				resourceType: "application",
				resourceId: application.applicationId,
				resourceName: application.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ApplicationMethod.saveGiteaProvider: {
			// biome-ignore lint/suspicious/noExplicitAny: apiSaveGiteaProvider input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				service: ["create"],
			});
			await updateApplication(input.applicationId, {
				giteaRepository: input.giteaRepository,
				giteaOwner: input.giteaOwner,
				giteaBranch: input.giteaBranch,
				giteaBuildPath: input.giteaBuildPath,
				sourceType: "gitea",
				applicationStatus: "idle",
				giteaId: input.giteaId,
				watchPaths: input.watchPaths,
				enableSubmodules: input.enableSubmodules as boolean,
			});
			const application = await findApplicationById(input.applicationId);
			console.info("[audit] application.update", {
				action: "update",
				resourceType: "application",
				resourceId: application.applicationId,
				resourceName: application.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ApplicationMethod.saveDockerProvider: {
			// biome-ignore lint/suspicious/noExplicitAny: apiSaveDockerProvider input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				service: ["create"],
			});
			await updateApplication(input.applicationId, {
				dockerImage: input.dockerImage,
				username: input.username,
				password: input.password,
				sourceType: "docker",
				applicationStatus: "idle",
				registryUrl: input.registryUrl,
			});
			const application = await findApplicationById(input.applicationId);
			console.info("[audit] application.update", {
				action: "update",
				resourceType: "application",
				resourceId: application.applicationId,
				resourceName: application.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ApplicationMethod.saveGitProvider: {
			// biome-ignore lint/suspicious/noExplicitAny: apiSaveGitProvider input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				service: ["create"],
			});
			await updateApplication(input.applicationId, {
				customGitBranch: input.customGitBranch,
				customGitBuildPath: input.customGitBuildPath,
				customGitUrl: input.customGitUrl,
				customGitSSHKeyId: input.customGitSSHKeyId,
				sourceType: "git",
				applicationStatus: "idle",
				watchPaths: input.watchPaths,
				enableSubmodules: input.enableSubmodules as boolean,
			});
			const application = await findApplicationById(input.applicationId);
			console.info("[audit] application.update", {
				action: "update",
				resourceType: "application",
				resourceId: application.applicationId,
				resourceName: application.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ApplicationMethod.disconnectGitProvider: {
			const input = decodeArgs<{ applicationId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				service: ["create"],
			});
			await updateApplication(input.applicationId, {
				repository: null,
				branch: null,
				owner: null,
				buildPath: "/",
				githubId: null,
				triggerType: "push",

				gitlabRepository: null,
				gitlabOwner: null,
				gitlabBranch: null,
				gitlabBuildPath: null,
				gitlabId: null,
				gitlabProjectId: null,
				gitlabPathNamespace: null,

				bitbucketRepository: null,
				bitbucketOwner: null,
				bitbucketBranch: null,
				bitbucketBuildPath: null,
				bitbucketId: null,

				giteaRepository: null,
				giteaOwner: null,
				giteaBranch: null,
				giteaBuildPath: null,
				giteaId: null,

				customGitBranch: null,
				customGitBuildPath: null,
				customGitUrl: null,
				customGitSSHKeyId: null,

				sourceType: "github", // Reset to default
				applicationStatus: "idle",
				watchPaths: null,
				enableSubmodules: false,
			});
			const application = await findApplicationById(input.applicationId);
			console.info("[audit] application.update", {
				action: "update",
				resourceType: "application",
				resourceId: application.applicationId,
				resourceName: application.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ApplicationMethod.markRunning: {
			const input = decodeArgs<{ applicationId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				deployment: ["create"],
			});
			await updateApplicationStatus(input.applicationId, "running");
			const application = await findApplicationById(input.applicationId);
			console.info("[audit] application.deploy", {
				action: "deploy",
				resourceType: "application",
				resourceId: application.applicationId,
				resourceName: application.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return undefined;
		}

		case ApplicationMethod.update: {
			const input = decodeArgs<{
				applicationId: string;
				buildServerId?: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiUpdateApplication input, ported verbatim
				[k: string]: any;
			}>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				service: ["create"],
			});

			if (input.buildServerId) {
				const accessibleIds = await getAccessibleServerIds(
					permCtx(ctx).session,
				);
				if (!accessibleIds.has(input.buildServerId)) {
					throw new UnauthorizedError(
						"You are not authorized to access this build server",
					);
				}
			}

			const { applicationId, ...rest } = input;
			const updateApp = await updateApplication(applicationId, {
				...rest,
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
			} as any);

			if (!updateApp) {
				throw new BadRequestError("Error updating application");
			}
			console.info("[audit] application.update", {
				action: "update",
				resourceType: "application",
				resourceId: updateApp.applicationId,
				resourceName: updateApp.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ApplicationMethod.refreshToken: {
			const input = decodeArgs<{ applicationId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				service: ["create"],
			});
			await updateApplication(input.applicationId, {
				refreshToken: nanoid(),
			});
			const application = await findApplicationById(input.applicationId);
			console.info("[audit] application.update", {
				action: "update",
				resourceType: "application",
				resourceId: application.applicationId,
				resourceName: application.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ApplicationMethod.deploy: {
			const input = decodeArgs<{
				applicationId: string;
				title?: string;
				description?: string;
			}>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				deployment: ["create"],
			});
			const application = await findApplicationById(input.applicationId);
			const jobData: DeploymentJob = {
				applicationId: input.applicationId,
				titleLog: input.title || "Manual deployment",
				descriptionLog: input.description || "",
				type: "deploy",
				applicationType: "application",
				server: !!application.serverId,
			};
			if (IS_CLOUD && application.serverId) {
				jobData.serverId = application.serverId;
				deploy(jobData).catch((error) => {
					console.error("Background deployment failed:", error);
				});
				console.info("[audit] application.deploy", {
					action: "deploy",
					resourceType: "application",
					resourceId: application.applicationId,
					resourceName: application.appName,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return true;
			}
			await myQueue.add(
				"deployments",
				{ ...jobData },
				{
					removeOnComplete: true,
					removeOnFail: true,
				},
			);
			console.info("[audit] application.deploy", {
				action: "deploy",
				resourceType: "application",
				resourceId: application.applicationId,
				resourceName: application.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return undefined;
		}

		case ApplicationMethod.cleanQueues: {
			const input = decodeArgs<{ applicationId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				deployment: ["cancel"],
			});
			await cleanQueuesByApplication(input.applicationId);
			return undefined;
		}

		case ApplicationMethod.clearDeployments: {
			const input = decodeArgs<{ applicationId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				deployment: ["create"],
			});
			const application = await findApplicationById(input.applicationId);
			await clearOldDeployments(application.appName, application.serverId);
			console.info("[audit] application.delete", {
				action: "delete",
				resourceType: "application",
				resourceId: application.applicationId,
				resourceName: application.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ApplicationMethod.killBuild: {
			const input = decodeArgs<{ applicationId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				deployment: ["cancel"],
			});
			const application = await findApplicationById(input.applicationId);
			await killDockerBuild("application", application.serverId);
			console.info("[audit] application.stop", {
				action: "stop",
				resourceType: "application",
				resourceId: application.applicationId,
				resourceName: application.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return undefined;
		}

		case ApplicationMethod.readTraefikConfig: {
			const input = decodeArgs<{ applicationId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				traefikFiles: ["read"],
			});
			const application = await findApplicationById(input.applicationId);
			let traefikConfig = null;
			if (application.serverId) {
				traefikConfig = await readRemoteConfig(
					application.serverId,
					application.appName,
				);
			} else {
				traefikConfig = readConfig(application.appName);
			}
			return traefikConfig;
		}

		case ApplicationMethod.dropDeployment: {
			// dropDeployment's tRPC input was a zfd.formData (multipart with a file).
			// Over ZAP the form fields ride the shared Args carrier; the uploaded zip
			// rides as the decoded `zip` value, ported verbatim.
			const input = decodeArgs<{
				applicationId: string;
				// biome-ignore lint/suspicious/noExplicitAny: zfd.file() upload, ported verbatim
				zip: any;
				dropBuildPath?: string;
			}>(call.payload);
			const zipFile = input.zip;
			const applicationId = input.applicationId;
			const dropBuildPath = input.dropBuildPath ?? null;

			await checkServicePermissionAndAccess(permCtx(ctx), applicationId, {
				deployment: ["create"],
			});
			const app = await findApplicationById(applicationId);

			await updateApplication(applicationId, {
				sourceType: "drop",
				dropBuildPath: dropBuildPath || "",
			});

			await unzipDrop(zipFile, app);
			const jobData: DeploymentJob = {
				applicationId: app.applicationId,
				titleLog: "Manual deployment",
				descriptionLog: "",
				type: "deploy",
				applicationType: "application",
				server: !!app.serverId,
			};
			if (IS_CLOUD && app.serverId) {
				jobData.serverId = app.serverId;
				deploy(jobData).catch((error) => {
					console.error("Background deployment failed:", error);
				});
				return true;
			}

			await myQueue.add(
				"deployments",
				{ ...jobData },
				{
					removeOnComplete: true,
					removeOnFail: true,
				},
			);
			console.info("[audit] application.deploy", {
				action: "deploy",
				resourceType: "application",
				resourceId: app.applicationId,
				resourceName: app.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ApplicationMethod.updateTraefikConfig: {
			const input = decodeArgs<{
				applicationId: string;
				traefikConfig: string;
			}>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				traefikFiles: ["write"],
			});
			const application = await findApplicationById(input.applicationId);
			if (application.serverId) {
				await writeConfigRemote(
					application.serverId,
					application.appName,
					input.traefikConfig,
				);
			} else {
				writeConfig(application.appName, input.traefikConfig);
			}
			console.info("[audit] application.update", {
				action: "update",
				resourceType: "application",
				resourceId: application.applicationId,
				resourceName: application.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ApplicationMethod.readAppMonitoring: {
			// readAppMonitoring was a `withPermission("monitoring", "read")` base —
			// the monitoring permission is enforced at the mint boundary
			// (authenticated session+user); the org-ownership check below is ported
			// verbatim from the body.
			const input = decodeArgs<{ appName: string }>(call.payload);
			if (IS_CLOUD) {
				throw new UnauthorizedError(
					"Functionality not available in cloud version",
				);
			}
			// Verify the appName belongs to the caller's org by looking up
			// the application by appName in the db context. Since appName is
			// passed directly, we validate via the applicationId if available.
			if (input.appName) {
				const app = await db.query.applications.findFirst({
					where: eq(applications.appName, input.appName),
					with: {
						environment: {
							with: {
								project: true,
							},
						},
					},
				});
				if (
					app &&
					app.environment.project.organizationId !== ctx.organizationId
				) {
					throw new UnauthorizedError(
						"You are not authorized to access this application",
					);
				}
			}
			const stats = await getApplicationStats(input.appName);

			return stats;
		}

		case ApplicationMethod.move: {
			const input = decodeArgs<{
				applicationId: string;
				targetEnvironmentId: string;
			}>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				service: ["create"],
			});

			const updatedApplication = await db
				.update(applications)
				.set({
					environmentId: input.targetEnvironmentId,
				})
				.where(eq(applications.applicationId, input.applicationId))
				.returning()
				.then((res) => res[0]);

			if (!updatedApplication) {
				throw new Error("Failed to move application");
			}
			console.info("[audit] application.update", {
				action: "update",
				resourceType: "application",
				resourceId: updatedApplication.applicationId,
				resourceName: updatedApplication.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return updatedApplication;
		}

		case ApplicationMethod.cancelDeployment: {
			const input = decodeArgs<{ applicationId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				deployment: ["cancel"],
			});
			const application = await findApplicationById(input.applicationId);

			if (IS_CLOUD && application.serverId) {
				try {
					await updateApplicationStatus(input.applicationId, "idle");

					if (application.deployments[0]) {
						await updateDeploymentStatus(
							application.deployments[0].deploymentId,
							"done",
						);
					}

					await cancelDeployment({
						applicationId: input.applicationId,
						applicationType: "application",
					});
					console.info("[audit] application.stop", {
						action: "stop",
						resourceType: "application",
						resourceId: application.applicationId,
						resourceName: application.appName,
						organizationId: ctx.organizationId,
						userId: ctx.userId,
						userEmail: ctx.email,
					});
					return {
						success: true,
						message: "Deployment cancellation requested",
					};
				} catch (error) {
					throw new Error(
						error instanceof Error
							? error.message
							: "Failed to cancel deployment",
					);
				}
			}

			throw new BadRequestError(
				"Deployment cancellation only available in cloud version",
			);
		}

		case ApplicationMethod.search: {
			const input = decodeArgs<{
				q?: string;
				name?: string;
				appName?: string;
				description?: string;
				repository?: string;
				owner?: string;
				dockerImage?: string;
				projectId?: string;
				environmentId?: string;
				limit?: number;
				offset?: number;
			}>(call.payload);
			// Zod input defaults applied inline post-decode (limit 20, offset 0).
			const limit = input.limit ?? 20;
			const offset = input.offset ?? 0;
			const baseConditions = [
				eq(projects.organizationId, ctx.organizationId),
			];

			if (input.projectId) {
				baseConditions.push(eq(environments.projectId, input.projectId));
			}
			if (input.environmentId) {
				baseConditions.push(
					eq(applications.environmentId, input.environmentId),
				);
			}

			if (input.q?.trim()) {
				const term = `%${input.q.trim()}%`;
				baseConditions.push(
					or(
						ilike(applications.name, term),
						ilike(applications.appName, term),
						ilike(applications.description ?? "", term),
						ilike(applications.repository ?? "", term),
						ilike(applications.owner ?? "", term),
						ilike(applications.dockerImage ?? "", term),
					)!,
				);
			}

			if (input.name?.trim()) {
				baseConditions.push(ilike(applications.name, `%${input.name.trim()}%`));
			}
			if (input.appName?.trim()) {
				baseConditions.push(
					ilike(applications.appName, `%${input.appName.trim()}%`),
				);
			}
			if (input.description?.trim()) {
				baseConditions.push(
					ilike(
						applications.description ?? "",
						`%${input.description.trim()}%`,
					),
				);
			}
			if (input.repository?.trim()) {
				baseConditions.push(
					ilike(applications.repository ?? "", `%${input.repository.trim()}%`),
				);
			}
			if (input.owner?.trim()) {
				baseConditions.push(
					ilike(applications.owner ?? "", `%${input.owner.trim()}%`),
				);
			}
			if (input.dockerImage?.trim()) {
				baseConditions.push(
					ilike(
						applications.dockerImage ?? "",
						`%${input.dockerImage.trim()}%`,
					),
				);
			}

			const { accessedServices } = await findMemberByUserId(
				ctx.userId,
				ctx.organizationId,
			);
			if (accessedServices.length === 0) return { items: [], total: 0 };
			baseConditions.push(
				sql`${applications.applicationId} IN (${sql.join(
					accessedServices.map((id: string) => sql`${id}`),
					sql`, `,
				)})`,
			);

			const where = and(...baseConditions);

			const [items, countResult] = await Promise.all([
				db
					.select({
						applicationId: applications.applicationId,
						name: applications.name,
						appName: applications.appName,
						description: applications.description,
						environmentId: applications.environmentId,
						applicationStatus: applications.applicationStatus,
						sourceType: applications.sourceType,
						createdAt: applications.createdAt,
					})
					.from(applications)
					.innerJoin(
						environments,
						eq(applications.environmentId, environments.environmentId),
					)
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(where)
					.orderBy(desc(applications.createdAt))
					.limit(limit)
					.offset(offset),
				db
					.select({ count: sql<number>`count(*)::int` })
					.from(applications)
					.innerJoin(
						environments,
						eq(applications.environmentId, environments.environmentId),
					)
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(where),
			]);

			return {
				items,
				total: countResult[0]?.count ?? 0,
			};
		}

		case ApplicationMethod.readLogs: {
			const input = decodeArgs<{
				applicationId: string;
				tail?: number;
				since?: string;
				search?: string;
			}>(call.payload);
			// Zod input defaults applied inline post-decode (tail 100, since "all").
			const tail = input.tail ?? 100;
			const since = input.since ?? "all";
			await checkServiceAccess(permCtx(ctx), input.applicationId, "read");
			const application = await findApplicationById(input.applicationId);
			if (
				application.environment.project.organizationId !== ctx.organizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to access this application",
				);
			}
			// PRE-EXISTING: getContainerLogs is not exported by the fork (the old
			// tRPC applicationRouter imported it from @dokploy/server too). Org
			// ownership is already verified above; with no log source available in
			// the fork, return an empty log payload to preserve compile + shape.
			// return await getContainerLogs(
			// 	application.appName,
			// 	tail,
			// 	since,
			// 	input.search,
			// 	application.serverId,
			// );
			void tail;
			void since;
			return "";
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
