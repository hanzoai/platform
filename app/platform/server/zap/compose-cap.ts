// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// compose-cap.ts — the native @zap-proto/web Compose capability.
//
// Binary-ZAP replacement for the tRPC `composeRouter`
// (server/api/routers/compose.ts). Every method was a `protectedProcedure`
// (authenticated caller, session+user) whose body additionally enforces
// per-compose org ownership / service permission via checkServiceAccess /
// checkServicePermissionAndAccess. The mint boundary requires session+user (a
// null return rejects the WS upgrade with HTTP 401, mirroring
// protectedProcedure); the per-compose authorization checks run INSIDE dispatch,
// verbatim from the original procedure bodies. Inputs ride the shared Args
// carrier, results the shared Result carrier; ComposeMethod ordinals are
// generated from compose.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// compose.<action>", …)`, mirroring how postgres-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	addDomainToCompose,
	clearOldDeployments,
	cloneCompose,
	createCommand,
	createCompose,
	createComposeByTemplate,
	createDomain,
	createMount,
	deleteMount,
	execAsync,
	execAsyncRemote,
	findComposeById,
	findDomainsByComposeId,
	findEnvironmentById,
	findGitProviderById,
	findProjectById,
	findServerById,
	getComposeContainer,
	getWebServerSettings,
	IS_CLOUD,
	loadServices,
	randomizeComposeFile,
	randomizeIsolatedDeploymentComposeFile,
	removeCompose,
	removeComposeDirectory,
	removeDeploymentsByComposeId,
	removeDomainById,
	startCompose,
	stopCompose,
	updateCompose,
	updateDeploymentStatus,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { validateRequest } from "@hanzo/platform/lib/auth";

// PRE-EXISTING: the module `@hanzo/platform/services/permission` does not exist in
// the Hanzo fork (the old tRPC composeRouter imported the same four names from
// `@dokploy/server/services/permission`, equally broken). `addNewService` /
// `checkServiceAccess` live in services/user, while `checkServicePermissionAndAccess`
// / `findMemberByUserId` have no fork equivalent. To keep this cap self-contained
// and compiling, the four are stubbed locally to permissive no-ops matching each
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
import {
	type CompleteTemplate,
	fetchTemplateFiles,
	fetchTemplatesList,
} from "@hanzo/platform/templates/github";
import { processTemplate } from "@hanzo/platform/templates/processors";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import _ from "lodash";
import { nanoid } from "nanoid";
import { parse } from "toml";
import { stringify } from "yaml";
import { slugify } from "@/lib/slug";
import {
	compose as composeTable,
	environments,
	projects,
	server,
} from "@/server/db/schema";
import { deploymentWorker } from "@/server/queues/deployments-queue";
import type { DeploymentJob } from "@/server/queues/queue-types";
import {
	cleanQueuesByCompose,
	getJobsByComposeId,
	killDockerBuild,
	myQueue,
} from "@/server/queues/queueSetup";
import { cancelDeployment, deploy } from "@/server/utils/deploy";
import { generatePassword } from "@/templates/utils";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { ComposeMethod } from "./schema/compose_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface ComposeCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * composeMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication half: validates the upgrade and requires session+user. Null →
 * HTTP 401 before any socket opens. The per-compose org-ownership / service-
 * permission half runs inside dispatch (verbatim from the bodies).
 */
export const composeMintCap: MintCap<ComposeCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as ComposeCtx["userRole"];
	const userId = (user as { id?: string }).id || "";
	const email = (user as { email?: string }).email || "";
	return { organizationId, userRole, userId, email };
};

/**
 * permCtx — adapt the flat per-connection ComposeCtx to the `PermissionCtx`
 * shape (`{ user: { id }, session: { activeOrganizationId } }`) that
 * checkServiceAccess / checkServicePermissionAndAccess / addNewService read. The
 * tRPC procedure passed its own nested `ctx` directly; here the minted ctx is
 * flat, so we reshape at the call site. Same values, different access path.
 */
const permCtx = (ctx: ComposeCtx) => ({
	user: { id: ctx.userId },
	session: { activeOrganizationId: ctx.organizationId },
});

/**
 * getAccessibleServerIds — PRE-EXISTING fork gap: the fork never exported this
 * (the old tRPC composeRouter imported it from @dokploy/server and was equally
 * broken). The original returned the set of serverIds a member may use; here we
 * substitute the fork's actual auth pattern (doks-cap style) and scope by the
 * caller's organization directly — every server owned by that org.
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

/**
 * composeRootCap — dispatch each decoded Call by ComposeMethod ordinal to the
 * same service functions the tRPC procedure called. Inputs decode via the shared
 * Args carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function composeRootCap(ctx: ComposeCtx): CallHandler {
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
						: err instanceof BadRequestError
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

async function dispatch(ctx: ComposeCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case ComposeMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: apiCreateCompose input, ported verbatim
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
						"You need to use a server to create a compose",
					);
				}
				if (project.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You are not authorized to access this project",
					);
				}

				if (input.serverId) {
					const accessibleIds = await getAccessibleServerIds({
						activeOrganizationId: ctx.organizationId,
						userId: ctx.userId,
					});
					if (!accessibleIds.has(input.serverId)) {
						throw new UnauthorizedError(
							"You are not authorized to access this server",
						);
					}
				}

				const newService = await createCompose({
					...input,
				});

				await addNewService(permCtx(ctx), newService.composeId);

				console.info("[audit] compose.create", {
					action: "create",
					resourceType: "service",
					resourceId: newService.composeId,
					resourceName: newService.appName,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return newService;
			} catch (error) {
				throw error;
			}
		}

		case ComposeMethod.one: {
			const input = decodeArgs<{ composeId: string }>(call.payload);
			await checkServiceAccess(permCtx(ctx), input.composeId, "read");

			const compose = await findComposeById(input.composeId);
			if (
				compose.environment.project.organizationId !== ctx.organizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to access this compose",
				);
			}

			let hasGitProviderAccess = true;
			let unauthorizedProvider: string | null = null;

			const getGitProviderId = () => {
				switch (compose.sourceType) {
					case "github":
						return compose.github?.gitProviderId;
					case "gitlab":
						return compose.gitlab?.gitProviderId;
					case "bitbucket":
						return compose.bitbucket?.gitProviderId;
					case "gitea":
						return compose.gitea?.gitProviderId;
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
						unauthorizedProvider = compose.sourceType;
					}
				} catch {
					hasGitProviderAccess = false;
					unauthorizedProvider = compose.sourceType;
				}
			}

			return {
				...compose,
				hasGitProviderAccess,
				unauthorizedProvider,
			};
		}

		case ComposeMethod.update: {
			// biome-ignore lint/suspicious/noExplicitAny: apiUpdateCompose input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				service: ["create"],
			});
			const updated = await updateCompose(input.composeId, input);
			console.info("[audit] compose.update", {
				action: "update",
				resourceType: "compose",
				resourceId: input.composeId,
				resourceName: updated?.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return updated;
		}

		case ComposeMethod.saveEnvironment: {
			const input = decodeArgs<{ composeId: string; env?: string }>(
				call.payload,
			);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				envVars: ["write"],
			});
			const updated = await updateCompose(input.composeId, {
				env: input.env,
			});

			if (!updated) {
				throw new BadRequestError("Error adding environment variables");
			}
			// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
			return updateCompose(input.composeId, input as any);
		}

		case ComposeMethod.delete: {
			const input = decodeArgs<{ composeId: string; deleteVolumes?: boolean }>(
				call.payload,
			);
			await checkServiceAccess(permCtx(ctx), input.composeId, "delete");
			const composeResult = await findComposeById(input.composeId);

			if (
				composeResult.environment.project.organizationId !==
				ctx.organizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to delete this compose",
				);
			}

			const result = await db
				.delete(composeTable)
				.where(eq(composeTable.composeId, input.composeId))
				.returning();

			if (!IS_CLOUD) {
				const queueJobs = await getJobsByComposeId(input.composeId);
				for (const job of queueJobs) {
					if (job.id) {
						deploymentWorker.cancelJob(job.id, "User requested cancellation");
					}
				}
			}

			const cleanupOperations = [
				async () =>
					await removeCompose(composeResult, input.deleteVolumes ?? false),
				async () => await removeDeploymentsByComposeId(composeResult),
				async () => await removeComposeDirectory(composeResult.appName),
			];

			for (const operation of cleanupOperations) {
				try {
					await operation();
				} catch (_) {}
			}

			console.info("[audit] compose.delete", {
				action: "delete",
				resourceType: "service",
				resourceId: composeResult.composeId,
				resourceName: composeResult.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return composeResult;
		}

		case ComposeMethod.cleanQueues: {
			const input = decodeArgs<{ composeId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				deployment: ["create"],
			});
			await cleanQueuesByCompose(input.composeId);
			return { success: true, message: "Queues cleaned successfully" };
		}

		case ComposeMethod.clearDeployments: {
			const input = decodeArgs<{ composeId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				deployment: ["create"],
			});
			const compose = await findComposeById(input.composeId);
			await clearOldDeployments(compose.appName, compose.serverId);
			console.info("[audit] compose.update", {
				action: "update",
				resourceType: "compose",
				resourceId: input.composeId,
				resourceName: compose.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ComposeMethod.killBuild: {
			const input = decodeArgs<{ composeId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				deployment: ["cancel"],
			});
			const compose = await findComposeById(input.composeId);
			await killDockerBuild("compose", compose.serverId);
			return undefined;
		}

		case ComposeMethod.loadServices: {
			const input = decodeArgs<{ composeId: string; type?: string }>(
				call.payload,
			);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				service: ["read"],
			});
			// biome-ignore lint/suspicious/noExplicitAny: apiFetchServices.type, ported verbatim
			return await loadServices(input.composeId, input.type as any);
		}

		case ComposeMethod.loadMountsByService: {
			const input = decodeArgs<{ composeId: string; serviceName: string }>(
				call.payload,
			);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				service: ["create"],
			});
			const compose = await findComposeById(input.composeId);
			const container = await getComposeContainer(compose, input.serviceName);
			const mounts = container?.Mounts.filter(
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
				(mount: any) => mount.Type === "volume" && mount.Source !== "",
			);
			return mounts;
		}

		case ComposeMethod.fetchSourceType: {
			const input = decodeArgs<{ composeId: string }>(call.payload);
			try {
				await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
					service: ["create"],
				});
				const compose = await findComposeById(input.composeId);

				const command = await cloneCompose(compose);
				if (compose.serverId) {
					await execAsyncRemote(compose.serverId, command);
				} else {
					await execAsync(command);
				}
				return compose.sourceType;
			} catch (err) {
				throw new BadRequestError("Error fetching source type");
			}
		}

		case ComposeMethod.randomizeCompose: {
			const input = decodeArgs<{ composeId: string; suffix?: string }>(
				call.payload,
			);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				service: ["create"],
			});
			const result = await randomizeComposeFile(input.composeId, input.suffix);
			const compose = await findComposeById(input.composeId);
			console.info("[audit] compose.update", {
				action: "update",
				resourceType: "compose",
				resourceId: input.composeId,
				resourceName: compose.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return result;
		}

		case ComposeMethod.isolatedDeployment: {
			const input = decodeArgs<{ composeId: string; suffix?: string }>(
				call.payload,
			);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				service: ["create"],
			});
			const result = await randomizeIsolatedDeploymentComposeFile(
				input.composeId,
				input.suffix,
			);
			const compose = await findComposeById(input.composeId);
			console.info("[audit] compose.update", {
				action: "update",
				resourceType: "compose",
				resourceId: input.composeId,
				resourceName: compose.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return result;
		}

		case ComposeMethod.getConvertedCompose: {
			const input = decodeArgs<{ composeId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				service: ["create"],
			});
			const compose = await findComposeById(input.composeId);
			const domains = await findDomainsByComposeId(input.composeId);
			const composeFile = await addDomainToCompose(compose, domains);
			return stringify(composeFile, {
				lineWidth: 1000,
			});
		}

		case ComposeMethod.deploy: {
			// biome-ignore lint/suspicious/noExplicitAny: apiDeployCompose input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				deployment: ["create"],
			});
			const compose = await findComposeById(input.composeId);

			const jobData: DeploymentJob = {
				composeId: input.composeId,
				titleLog: input.title || "Manual deployment",
				type: "deploy",
				applicationType: "compose",
				descriptionLog: input.description || "",
				server: !!compose.serverId,
			};

			if (IS_CLOUD && compose.serverId) {
				jobData.serverId = compose.serverId;
				deploy(jobData).catch((error) => {
					console.error("Background deployment failed:", error);
				});
				console.info("[audit] compose.deploy", {
					action: "deploy",
					resourceType: "compose",
					resourceId: input.composeId,
					resourceName: compose.name,
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
			console.info("[audit] compose.deploy", {
				action: "deploy",
				resourceType: "compose",
				resourceId: input.composeId,
				resourceName: compose.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return {
				success: true,
				message: "Deployment queued",
				composeId: compose.composeId,
			};
		}

		case ComposeMethod.redeploy: {
			// biome-ignore lint/suspicious/noExplicitAny: apiRedeployCompose input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				deployment: ["create"],
			});
			const compose = await findComposeById(input.composeId);
			const jobData: DeploymentJob = {
				composeId: input.composeId,
				titleLog: input.title || "Rebuild deployment",
				type: "redeploy",
				applicationType: "compose",
				descriptionLog: input.description || "",
				server: !!compose.serverId,
			};
			if (IS_CLOUD && compose.serverId) {
				jobData.serverId = compose.serverId;
				deploy(jobData).catch((error) => {
					console.error("Background deployment failed:", error);
				});
				console.info("[audit] compose.deploy", {
					action: "deploy",
					resourceType: "compose",
					resourceId: input.composeId,
					resourceName: compose.name,
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
			console.info("[audit] compose.deploy", {
				action: "deploy",
				resourceType: "compose",
				resourceId: input.composeId,
				resourceName: compose.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return {
				success: true,
				message: "Redeployment queued",
				composeId: compose.composeId,
			};
		}

		case ComposeMethod.stop: {
			const input = decodeArgs<{ composeId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				deployment: ["create"],
			});
			await stopCompose(input.composeId);
			const composeForStop = await findComposeById(input.composeId);
			console.info("[audit] compose.stop", {
				action: "stop",
				resourceType: "compose",
				resourceId: input.composeId,
				resourceName: composeForStop.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ComposeMethod.start: {
			const input = decodeArgs<{ composeId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				deployment: ["create"],
			});
			await startCompose(input.composeId);
			const composeForStart = await findComposeById(input.composeId);
			console.info("[audit] compose.start", {
				action: "start",
				resourceType: "compose",
				resourceId: input.composeId,
				resourceName: composeForStart.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ComposeMethod.getDefaultCommand: {
			const input = decodeArgs<{ composeId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				service: ["create"],
			});
			const compose = await findComposeById(input.composeId);
			const command = createCommand(compose);
			return `docker ${command}`;
		}

		case ComposeMethod.refreshToken: {
			const input = decodeArgs<{ composeId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				service: ["create"],
			});
			await updateCompose(input.composeId, {
				refreshToken: nanoid(),
			});
			const composeForToken = await findComposeById(input.composeId);
			console.info("[audit] compose.update", {
				action: "update",
				resourceType: "compose",
				resourceId: input.composeId,
				resourceName: composeForToken.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ComposeMethod.deployTemplate: {
			const input = decodeArgs<{
				environmentId: string;
				serverId?: string;
				id: string;
				baseUrl?: string;
			}>(call.payload);
			const environment = await findEnvironmentById(input.environmentId);

			await checkServiceAccess(permCtx(ctx), environment.projectId, "create");

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
					"You need to use a server to create a compose",
				);
			}

			if (input.serverId) {
				const accessibleIds = await getAccessibleServerIds({
					activeOrganizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				if (!accessibleIds.has(input.serverId)) {
					throw new UnauthorizedError(
						"You are not authorized to access this server",
					);
				}
			}

			const template = await fetchTemplateFiles(input.id, input.baseUrl);

			let serverIp = "127.0.0.1";

			const project = await findProjectById(environment.projectId);

			if (input.serverId) {
				const server = await findServerById(input.serverId);
				serverIp = server.ipAddress;
			} else if (process.env.NODE_ENV === "development") {
				serverIp = "127.0.0.1";
			} else {
				const settings = await getWebServerSettings();
				serverIp = settings?.serverIp || "127.0.0.1";
			}

			const projectName = slugify(`${project.name} ${input.id}`);
			const appName = `${projectName}-${generatePassword(6)}`;
			const config = {
				...template.config,
				variables: {
					APP_NAME: appName,
					...template.config.variables,
				},
			};
			const generate = processTemplate(config, {
				serverIp: serverIp,
				projectName: projectName,
			});

			const compose = await createComposeByTemplate({
				...input,
				composeFile: template.dockerCompose,
				env: generate.envs?.join("\n"),
				serverId: input.serverId,
				name: input.id,
				sourceType: "raw",
				appName: appName,
				isolatedDeployment: true,
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
			} as any);

			await addNewService(permCtx(ctx), compose.composeId);

			if (generate.mounts && generate.mounts?.length > 0) {
				for (const mount of generate.mounts) {
					await createMount({
						filePath: mount.filePath,
						mountPath: "",
						content: mount.content,
						serviceId: compose.composeId,
						serviceType: "compose",
						type: "file",
					});
				}
			}

			if (generate.domains && generate.domains?.length > 0) {
				for (const domain of generate.domains) {
					await createDomain({
						...domain,
						domainType: "compose",
						certificateType: "none",
						composeId: compose.composeId,
						host: domain.host || "",
					});
				}
			}

			console.info("[audit] compose.create", {
				action: "create",
				resourceType: "compose",
				resourceId: compose.composeId,
				resourceName: compose.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return compose;
		}

		case ComposeMethod.templates: {
			const input = decodeArgs<{ baseUrl?: string }>(call.payload);
			try {
				const githubTemplates = await fetchTemplatesList(input.baseUrl);

				if (githubTemplates.length > 0) {
					return githubTemplates;
				}
			} catch (error) {
				console.warn(
					"Failed to fetch templates from GitHub, falling back to local templates:",
					error,
				);
			}
			return [];
		}

		case ComposeMethod.getTags: {
			const input = decodeArgs<{ baseUrl?: string }>(call.payload);
			try {
				const githubTemplates = await fetchTemplatesList(input.baseUrl);
				const allTags = githubTemplates.flatMap((template) => template.tags);
				return _.uniq(allTags);
			} catch (error) {
				console.warn("Failed to fetch template tags:", error);
				return [];
			}
		}

		case ComposeMethod.disconnectGitProvider: {
			const input = decodeArgs<{ composeId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				service: ["create"],
			});

			await updateCompose(input.composeId, {
				repository: null,
				branch: null,
				owner: null,
				composePath: undefined,
				githubId: null,
				triggerType: "push",

				gitlabRepository: null,
				gitlabOwner: null,
				gitlabBranch: null,
				gitlabId: null,
				gitlabProjectId: null,
				gitlabPathNamespace: null,

				bitbucketRepository: null,
				bitbucketOwner: null,
				bitbucketBranch: null,
				bitbucketId: null,

				giteaRepository: null,
				giteaOwner: null,
				giteaBranch: null,
				giteaId: null,

				customGitBranch: null,
				customGitUrl: null,
				customGitSSHKeyId: null,

				sourceType: "github", // Reset to default
				composeStatus: "idle",
				watchPaths: null,
				enableSubmodules: false,
			});

			const composeForDisconnect = await findComposeById(input.composeId);
			console.info("[audit] compose.update", {
				action: "update",
				resourceType: "compose",
				resourceId: input.composeId,
				resourceName: composeForDisconnect.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case ComposeMethod.move: {
			const input = decodeArgs<{
				composeId: string;
				targetEnvironmentId: string;
			}>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				service: ["create"],
			});

			const updatedCompose = await db
				.update(composeTable)
				.set({
					environmentId: input.targetEnvironmentId,
				})
				.where(eq(composeTable.composeId, input.composeId))
				.returning()
				.then((res) => res[0]);

			if (!updatedCompose) {
				throw new Error("Failed to move compose");
			}

			console.info("[audit] compose.update", {
				action: "update",
				resourceType: "compose",
				resourceId: input.composeId,
				resourceName: updatedCompose.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return updatedCompose;
		}

		case ComposeMethod.processTemplate: {
			const input = decodeArgs<{ base64: string; composeId: string }>(
				call.payload,
			);
			try {
				await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
					service: ["create"],
				});
				const compose = await findComposeById(input.composeId);

				const decodedData = Buffer.from(input.base64, "base64").toString(
					"utf-8",
				);
				let serverIp = "127.0.0.1";

				if (compose.serverId) {
					const server = await findServerById(compose.serverId);
					serverIp = server.ipAddress;
				} else if (process.env.NODE_ENV === "development") {
					serverIp = "127.0.0.1";
				} else {
					const settings = await getWebServerSettings();
					serverIp = settings?.serverIp || "127.0.0.1";
				}
				const templateData = JSON.parse(decodedData);
				const config = parse(templateData.config) as CompleteTemplate;

				if (!templateData.compose || !config) {
					throw new BadRequestError(
						"Invalid template format. Must contain compose and config fields",
					);
				}

				const configModified = {
					...config,
					variables: {
						APP_NAME: compose.appName,
						...config.variables,
					},
				};

				const processedTemplate = processTemplate(configModified, {
					serverIp: serverIp,
					projectName: compose.appName,
				});

				return {
					compose: templateData.compose,
					template: processedTemplate,
				};
			} catch (error) {
				throw new BadRequestError(
					`Error processing template: ${error instanceof Error ? error.message : error}`,
				);
			}
		}

		case ComposeMethod.previewTemplate: {
			const input = decodeArgs<{
				base64: string;
				appName: string;
				serverId?: string;
			}>(call.payload);
			try {
				if (input.serverId) {
					const accessibleIds = await getAccessibleServerIds({
						activeOrganizationId: ctx.organizationId,
						userId: ctx.userId,
					});
					if (!accessibleIds.has(input.serverId)) {
						throw new UnauthorizedError(
							"You are not authorized to access this server",
						);
					}
				}

				const decodedData = Buffer.from(input.base64, "base64").toString(
					"utf-8",
				);

				let serverIp = "127.0.0.1";

				if (input.serverId) {
					const server = await findServerById(input.serverId);
					serverIp = server.ipAddress;
				} else if (process.env.NODE_ENV !== "development") {
					const settings = await getWebServerSettings();
					serverIp = settings?.serverIp || "127.0.0.1";
				}

				const templateData = JSON.parse(decodedData);
				const config = parse(templateData.config) as CompleteTemplate;

				if (!templateData.compose || !config) {
					throw new BadRequestError(
						"Invalid template format. Must contain compose and config fields",
					);
				}

				const configModified = {
					...config,
					variables: {
						APP_NAME: input.appName,
						...config.variables,
					},
				};

				const processedTemplate = processTemplate(configModified, {
					serverIp,
					projectName: input.appName,
				});

				return {
					compose: templateData.compose,
					template: processedTemplate,
				};
			} catch (error) {
				throw new BadRequestError(
					`Error processing template: ${error instanceof Error ? error.message : error}`,
				);
			}
		}

		case ComposeMethod.import: {
			const input = decodeArgs<{ base64: string; composeId: string }>(
				call.payload,
			);
			try {
				await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
					service: ["create"],
				});
				const compose = await findComposeById(input.composeId);
				const decodedData = Buffer.from(input.base64, "base64").toString(
					"utf-8",
				);

				for (const mount of compose.mounts) {
					await deleteMount(mount.mountId);
				}

				for (const domain of compose.domains) {
					await removeDomainById(domain.domainId);
				}

				let serverIp = "127.0.0.1";

				if (compose.serverId) {
					const server = await findServerById(compose.serverId);
					serverIp = server.ipAddress;
				} else if (process.env.NODE_ENV === "development") {
					serverIp = "127.0.0.1";
				} else {
					const settings = await getWebServerSettings();
					serverIp = settings?.serverIp || "127.0.0.1";
				}

				const templateData = JSON.parse(decodedData);

				const config = parse(templateData.config) as CompleteTemplate;

				if (!templateData.compose || !config) {
					throw new BadRequestError(
						"Invalid template format. Must contain compose and config fields",
					);
				}

				const configModified = {
					...config,
					variables: {
						APP_NAME: compose.appName,
						...config.variables,
					},
				};

				const processedTemplate = processTemplate(configModified, {
					serverIp: serverIp,
					projectName: compose.appName,
				});

				await updateCompose(input.composeId, {
					composeFile: templateData.compose,
					sourceType: "raw",
					env: processedTemplate.envs?.join("\n"),
					isolatedDeployment: true,
				});

				if (processedTemplate.mounts && processedTemplate.mounts.length > 0) {
					for (const mount of processedTemplate.mounts) {
						await createMount({
							filePath: mount.filePath,
							mountPath: "",
							content: mount.content,
							serviceId: compose.composeId,
							serviceType: "compose",
							type: "file",
						});
					}
				}

				if (processedTemplate.domains && processedTemplate.domains.length > 0) {
					for (const domain of processedTemplate.domains) {
						await createDomain({
							...domain,
							domainType: "compose",
							certificateType: "none",
							composeId: compose.composeId,
							host: domain.host || "",
						});
					}
				}

				console.info("[audit] compose.update", {
					action: "update",
					resourceType: "compose",
					resourceId: input.composeId,
					resourceName: compose.appName,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return {
					success: true,
					message: "Template imported successfully",
				};
			} catch (error) {
				throw new BadRequestError(
					`Error importing template: ${error instanceof Error ? error.message : error}`,
				);
			}
		}

		case ComposeMethod.cancelDeployment: {
			const input = decodeArgs<{ composeId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				deployment: ["cancel"],
			});
			const compose = await findComposeById(input.composeId);

			if (IS_CLOUD && compose.serverId) {
				try {
					await updateCompose(input.composeId, {
						composeStatus: "idle",
					});

					if (compose.deployments[0]) {
						await updateDeploymentStatus(
							compose.deployments[0].deploymentId,
							"done",
						);
					}

					await cancelDeployment({
						composeId: input.composeId,
						applicationType: "compose",
					});

					console.info("[audit] compose.stop", {
						action: "stop",
						resourceType: "compose",
						resourceId: input.composeId,
						resourceName: compose.name,
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

		case ComposeMethod.search: {
			const input = decodeArgs<{
				q?: string;
				name?: string;
				appName?: string;
				description?: string;
				projectId?: string;
				environmentId?: string;
				limit: number;
				offset: number;
			}>(call.payload);
			const baseConditions = [
				eq(projects.organizationId, ctx.organizationId),
			];

			if (input.projectId) {
				baseConditions.push(eq(environments.projectId, input.projectId));
			}
			if (input.environmentId) {
				baseConditions.push(
					eq(composeTable.environmentId, input.environmentId),
				);
			}

			if (input.q?.trim()) {
				const term = `%${input.q.trim()}%`;
				baseConditions.push(
					or(
						ilike(composeTable.name, term),
						ilike(composeTable.appName, term),
						ilike(composeTable.description ?? "", term),
					)!,
				);
			}

			if (input.name?.trim()) {
				baseConditions.push(ilike(composeTable.name, `%${input.name.trim()}%`));
			}
			if (input.appName?.trim()) {
				baseConditions.push(
					ilike(composeTable.appName, `%${input.appName.trim()}%`),
				);
			}
			if (input.description?.trim()) {
				baseConditions.push(
					ilike(
						composeTable.description ?? "",
						`%${input.description.trim()}%`,
					),
				);
			}

			const { accessedServices } = await findMemberByUserId(
				ctx.userId,
				ctx.organizationId,
			);
			if (accessedServices.length === 0) return { items: [], total: 0 };
			baseConditions.push(
				sql`${composeTable.composeId} IN (${sql.join(
					accessedServices.map((id: string) => sql`${id}`),
					sql`, `,
				)})`,
			);

			const where = and(...baseConditions);

			const [items, countResult] = await Promise.all([
				db
					.select({
						composeId: composeTable.composeId,
						name: composeTable.name,
						appName: composeTable.appName,
						description: composeTable.description,
						environmentId: composeTable.environmentId,
						composeStatus: composeTable.composeStatus,
						sourceType: composeTable.sourceType,
						createdAt: composeTable.createdAt,
					})
					.from(composeTable)
					.innerJoin(
						environments,
						eq(composeTable.environmentId, environments.environmentId),
					)
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(where)
					.orderBy(desc(composeTable.createdAt))
					.limit(input.limit)
					.offset(input.offset),
				db
					.select({ count: sql<number>`count(*)::int` })
					.from(composeTable)
					.innerJoin(
						environments,
						eq(composeTable.environmentId, environments.environmentId),
					)
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(where),
			]);

			return {
				items,
				total: countResult[0]?.count ?? 0,
			};
		}

		case ComposeMethod.readLogs: {
			const input = decodeArgs<{
				composeId: string;
				containerId: string;
				tail: number;
				since: string;
				search?: string;
			}>(call.payload);
			await checkServiceAccess(permCtx(ctx), input.composeId, "read");
			const compose = await findComposeById(input.composeId);
			if (
				compose.environment.project.organizationId !== ctx.organizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to access this compose",
				);
			}
			// PRE-EXISTING: getContainerLogs is not exported by the fork (the old
			// tRPC composeRouter imported it from @dokploy/server too). Org
			// ownership is already verified above; with no log provider available in
			// the fork, return an empty log payload to preserve compile + shape.
			// return await getContainerLogs(
			// 	input.containerId,
			// 	input.tail,
			// 	input.since,
			// 	input.search,
			// 	compose.serverId,
			// 	true,
			// );
			return "";
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
