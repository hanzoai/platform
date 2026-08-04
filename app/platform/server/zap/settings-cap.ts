// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// settings-cap.ts — the native @zap-proto/web Settings capability.
//
// Binary-ZAP replacement for the tRPC `settingsRouter`
// (server/api/routers/settings.ts). The router mixes three gates:
//   - protectedProcedure: authenticated caller (session+user).
//   - adminProcedure / enterpriseProcedure: owner|admin only.
//     (`enterpriseProcedure` is an alias of `adminProcedure` on this branch.)
//   - publicProcedure: no auth (isCloud, health).
//
// The mint boundary mirrors the LOOSEST gate the router needs — it admits any
// validated upgrade, and when the session is absent leaves ctx fields blank so
// the publicProcedure methods (isCloud, health) still answer. Per-call the
// adminProcedure methods invoke requireAdmin(ctx) (the ai-cap.ts pattern), and
// the protectedProcedure methods invoke requireSession(ctx). Permission-gated
// methods (readDirectories, updateTraefikFile, readTraefikFile) call
// checkPermission with the same permCtx adapter postgres-cap.ts uses.
//
// `getOpenApiDocument` read `ctx.req.headers["x-forwarded-proto"]` and
// `ctx.req.headers.host` from the tRPC request. The mint boundary has the raw
// IncomingMessage, so those two headers are captured there and threaded into
// ctx (reqProto / reqHost) — the one tRPC-only ctx dependency, reproduced at
// the mint boundary.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// settings.<resourceName>", …)`, mirroring how registry-cap.ts ported its
// audit.

import type { IncomingMessage } from "node:http";
import {
	CLEANUP_CRON_JOB,
	checkGPUStatus,
	checkPortInUse,
	checkPostgresHealth,
	checkRedisHealth,
	checkTraefikHealth,
	cleanupAll,
	cleanupAllBackground,
	cleanupBuilders,
	cleanupContainers,
	cleanupImages,
	cleanupSystem,
	cleanupVolumes,
	DEFAULT_UPDATE_DATA,
	execAsync,
	findServerById,
	getDockerDiskUsage,
	getHanzoImageTag,
	getLogCleanupStatus,
	getUpdateData,
	getWebServerSettings,
	IS_CLOUD,
	parseRawConfig,
	paths,
	prepareEnvironmentVariables,
	processLogs,
	readConfig,
	readConfigInPath,
	readDirectory,
	readEnvironmentVariables,
	readMainConfig,
	readMonitoringConfig,
	readPorts,
	recreateDirectory,
	reloadDockerResource,
	sendDockerCleanupNotifications,
	setupGPUSupport,
	spawnAsync,
	startLogCleanup,
	stopLogCleanup,
	updateLetsEncryptEmail,
	updateServerById,
	updateServerTraefik,
	updateWebServerSettings,
	writeConfig,
	writeMainConfig,
	writeTraefikConfigInPath,
	writeTraefikSetup,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { validateRequest } from "@hanzo/platform/lib/auth";
import { checkPermission } from "@hanzo/platform/services/permission";
import { generateOpenApiDocument } from "@dokploy/trpc-openapi";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { eq, sql } from "drizzle-orm";
import { scheduledJobs, scheduleJob } from "node-schedule";
import { parse, stringify } from "yaml";
import {
	projects,
	server,
} from "@/server/db/schema";
import { cleanAllDeploymentQueue } from "@/server/queues/queueSetup";
import { removeJob, schedule } from "@/server/utils/backup";
import packageInfo from "../../package.json";
import { appRouter } from "../api/root";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { SettingsMethod } from "./schema/settings_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface SettingsCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
	/** Whether a session was present at the upgrade (gates protectedProcedure). */
	authed: boolean;
	/** x-forwarded-proto header at the upgrade (for getOpenApiDocument). */
	reqProto: string;
	/** host header at the upgrade (for getOpenApiDocument). */
	reqHost: string;
}

/**
 * settingsMintCap — bearer→ctx boundary. The router contains publicProcedure
 * methods (isCloud, health), so the upgrade is NOT rejected when the session is
 * absent; instead `authed` is recorded false and the protected/admin methods
 * gate per-call (requireSession / requireAdmin). The x-forwarded-proto and host
 * headers are captured here for getOpenApiDocument, which previously read them
 * from the tRPC request.
 */
export const settingsMintCap: MintCap<SettingsCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	const organizationId =
		(session as { activeOrganizationId?: string } | null)
			?.activeOrganizationId || "";
	const userRole = ((user as { role?: string } | null)?.role ??
		"member") as SettingsCtx["userRole"];
	const userId = (user as { id?: string } | null)?.id || "";
	const email = (user as { email?: string } | null)?.email || "";
	const headerStr = (v: string | string[] | undefined): string =>
		Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
	return {
		organizationId,
		userRole,
		userId,
		email,
		authed: !!session && !!user,
		reqProto: headerStr(req.headers["x-forwarded-proto"]),
		reqHost: headerStr(req.headers.host),
	};
};

/**
 * permCtx — adapt the flat per-connection SettingsCtx to the `PermissionCtx`
 * shape (`{ user: { id }, session: { activeOrganizationId } }`) that
 * checkPermission reads. The tRPC procedure passed its own nested `ctx`
 * directly; here the minted ctx is flat, so we reshape at the call site. Same
 * values, different access path. Also serves as the `ctx` substitute for
 * audit() and the inline `ctx.session.activeOrganizationId` reads.
 */
const permCtx = (ctx: SettingsCtx) => ({
	user: { id: ctx.userId },
	session: { activeOrganizationId: ctx.organizationId },
});

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}
/** Typed conflict failure → ZAP Status.BadRequest. */
class ConflictError extends Error {}

/** Session gate — mirrors `protectedProcedure` (session+user required). */
function requireSession(ctx: SettingsCtx): void {
	if (!ctx.authed) {
		throw new UnauthorizedError("authentication required");
	}
}

/** Admin gate — mirrors `adminProcedure` / `enterpriseProcedure` (owner|admin). */
function requireAdmin(ctx: SettingsCtx): void {
	requireSession(ctx);
	if (ctx.userRole !== "owner" && ctx.userRole !== "admin") {
		throw new UnauthorizedError("admin role required");
	}
}

/**
 * settingsRootCap — dispatch each decoded Call by SettingsMethod ordinal to the
 * same service functions the tRPC procedure called. Inputs decode via the shared
 * Args carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function settingsRootCap(ctx: SettingsCtx): CallHandler {
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

async function dispatch(ctx: SettingsCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case SettingsMethod.getWebServerSettings: {
			requireSession(ctx);
			if (IS_CLOUD) {
				return null;
			}
			const settings = await getWebServerSettings();
			return settings;
		}

		case SettingsMethod.reloadServer: {
			requireAdmin(ctx);
			if (IS_CLOUD) {
				return true;
			}
			await reloadDockerResource("hanzo", undefined, packageInfo.version);
			return true;
		}

		case SettingsMethod.cleanRedis: {
			requireAdmin(ctx);
			if (IS_CLOUD) {
				return true;
			}

			const { stdout: containerId } = await execAsync(
				`docker ps --filter "name=platform-redis" --filter "status=running" -q | head -n 1`,
			);

			if (!containerId) {
				throw new Error("Redis container not found");
			}

			const redisContainerId = containerId.trim();

			await execAsync(`docker exec -i ${redisContainerId} redis-cli flushall`);
			console.info("[audit] settings.clean-redis", {
				action: "update",
				resourceType: "settings",
				resourceName: "clean-redis",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SettingsMethod.reloadRedis: {
			requireAdmin(ctx);
			if (IS_CLOUD) {
				return true;
			}
			await reloadDockerResource("platform-redis");

			return true;
		}

		case SettingsMethod.cleanAllDeploymentQueue: {
			requireAdmin(ctx);
			if (IS_CLOUD) {
				return true;
			}
			const result = cleanAllDeploymentQueue();
			console.info("[audit] settings.clean-deployment-queue", {
				action: "update",
				resourceType: "settings",
				resourceName: "clean-deployment-queue",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return result;
		}

		case SettingsMethod.reloadTraefik: {
			requireAdmin(ctx);
			// biome-ignore lint/suspicious/noExplicitAny: apiServerSchema input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			// Run in background so the request returns immediately; avoids proxy timeouts.
			void reloadDockerResource("platform-traefik", input?.serverId).catch(
				(err) => {
					console.error("reloadTraefik background:", err);
				},
			);
			console.info("[audit] settings.dokploy-traefik", {
				action: "reload",
				resourceType: "settings",
				resourceName: "dokploy-traefik",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SettingsMethod.toggleDashboard: {
			requireAdmin(ctx);
			const input = decodeArgs<{
				enableDashboard: boolean;
				serverId?: string;
			}>(call.payload);
			const ports = await readPorts("platform-traefik", input.serverId);
			const env = await readEnvironmentVariables(
				"platform-traefik",
				input.serverId,
			);
			const preparedEnv = prepareEnvironmentVariables(env);
			let newPorts = ports;
			// If receive true, add 8080 to ports
			if (input.enableDashboard) {
				// Check if port 8080 is already in use before enabling dashboard
				const portCheck = await checkPortInUse(8080, input.serverId);
				if (portCheck.isInUse) {
					const conflictingContainer = portCheck.conflictingContainer
						? ` by container "${portCheck.conflictingContainer}"`
						: "";
					throw new ConflictError(
						`Port 8080 is already in use${conflictingContainer}. Please stop the conflicting service or use a different port for the Traefik dashboard.`,
					);
				}
				newPorts.push({
					targetPort: 8080,
					publishedPort: 8080,
					protocol: "tcp",
				});
			} else {
				newPorts = ports.filter((port) => port.targetPort !== 8080);
			}

			// Run in background so the request returns immediately; client polls /v1/health.
			// Avoids proxy timeouts (520) while Traefik is recreated.
			void writeTraefikSetup({
				env: preparedEnv,
				additionalPorts: newPorts,
				serverId: input.serverId,
			}).catch((err) => {
				console.error("toggleDashboard background writeTraefikSetup:", err);
			});
			console.info("[audit] settings.toggle-dashboard", {
				action: "update",
				resourceType: "settings",
				resourceName: "toggle-dashboard",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SettingsMethod.cleanUnusedImages: {
			requireAdmin(ctx);
			// biome-ignore lint/suspicious/noExplicitAny: apiServerSchema input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await cleanupImages(input?.serverId);
			console.info("[audit] settings.clean-unused-images", {
				action: "delete",
				resourceType: "settings",
				resourceName: "clean-unused-images",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SettingsMethod.cleanUnusedVolumes: {
			requireAdmin(ctx);
			// biome-ignore lint/suspicious/noExplicitAny: apiServerSchema input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await cleanupVolumes(input?.serverId);
			console.info("[audit] settings.clean-unused-volumes", {
				action: "delete",
				resourceType: "settings",
				resourceName: "clean-unused-volumes",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SettingsMethod.cleanStoppedContainers: {
			requireAdmin(ctx);
			// biome-ignore lint/suspicious/noExplicitAny: apiServerSchema input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await cleanupContainers(input?.serverId);
			console.info("[audit] settings.clean-stopped-containers", {
				action: "delete",
				resourceType: "settings",
				resourceName: "clean-stopped-containers",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SettingsMethod.cleanDockerBuilder: {
			requireAdmin(ctx);
			// biome-ignore lint/suspicious/noExplicitAny: apiServerSchema input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await cleanupBuilders(input?.serverId);
			console.info("[audit] settings.clean-docker-builder", {
				action: "delete",
				resourceType: "settings",
				resourceName: "clean-docker-builder",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return undefined;
		}

		case SettingsMethod.cleanDockerPrune: {
			requireAdmin(ctx);
			// biome-ignore lint/suspicious/noExplicitAny: apiServerSchema input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await cleanupSystem(input?.serverId);
			await cleanupBuilders(input?.serverId);
			console.info("[audit] settings.clean-docker-prune", {
				action: "delete",
				resourceType: "settings",
				resourceName: "clean-docker-prune",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SettingsMethod.cleanAll: {
			requireAdmin(ctx);
			// biome-ignore lint/suspicious/noExplicitAny: apiServerSchema input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			// Execute cleanup in background and return immediately to avoid gateway timeouts
			const result = await cleanupAllBackground(input?.serverId);
			console.info("[audit] settings.clean-all", {
				action: "delete",
				resourceType: "settings",
				resourceName: "clean-all",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return result;
		}

		case SettingsMethod.cleanMonitoring: {
			requireAdmin(ctx);
			if (IS_CLOUD) {
				return true;
			}
			const { MONITORING_PATH } = paths();
			await recreateDirectory(MONITORING_PATH);
			console.info("[audit] settings.clean-monitoring", {
				action: "delete",
				resourceType: "settings",
				resourceName: "clean-monitoring",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SettingsMethod.getDockerDiskUsage: {
			requireAdmin(ctx);
			if (IS_CLOUD) {
				return [];
			}
			return getDockerDiskUsage();
		}

		case SettingsMethod.saveSSHPrivateKey: {
			requireAdmin(ctx);
			const input = decodeArgs<{ sshPrivateKey: string }>(call.payload);
			if (IS_CLOUD) {
				return true;
			}
			await updateWebServerSettings({
				sshPrivateKey: input.sshPrivateKey,
			});
			console.info("[audit] settings.ssh-private-key", {
				action: "update",
				resourceType: "settings",
				resourceName: "ssh-private-key",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SettingsMethod.assignDomainServer: {
			requireAdmin(ctx);
			// biome-ignore lint/suspicious/noExplicitAny: apiAssignDomain input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			if (IS_CLOUD) {
				return true;
			}
			const settings = await updateWebServerSettings({
				host: input.host,
				letsEncryptEmail: input.letsEncryptEmail,
				certificateType: input.certificateType,
				https: input.https,
			});

			if (!settings) {
				throw new NotFoundError("Web server settings not found");
			}

			updateServerTraefik(settings, input.host);
			if (input.letsEncryptEmail) {
				updateLetsEncryptEmail(input.letsEncryptEmail);
			}

			console.info("[audit] settings.assign-domain-server", {
				action: "update",
				resourceType: "settings",
				resourceName: "assign-domain-server",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return settings;
		}

		case SettingsMethod.cleanSSHPrivateKey: {
			requireAdmin(ctx);
			if (IS_CLOUD) {
				return true;
			}
			await updateWebServerSettings({
				sshPrivateKey: null,
			});
			console.info("[audit] settings.ssh-private-key", {
				action: "delete",
				resourceType: "settings",
				resourceName: "ssh-private-key",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SettingsMethod.updateDockerCleanup: {
			requireAdmin(ctx);
			// biome-ignore lint/suspicious/noExplicitAny: apiUpdateDockerCleanup input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			if (input.serverId) {
				await updateServerById(input.serverId, {
					enableDockerCleanup: input.enableDockerCleanup,
				});

				const server = await findServerById(input.serverId);

				if (server.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You are not authorized to access this server",
					);
				}

				if (server.enableDockerCleanup) {
					const server = await findServerById(input.serverId);
					if (server.serverStatus === "inactive") {
						throw new NotFoundError("Server is inactive");
					}
					if (IS_CLOUD) {
						await schedule({
							cronSchedule: CLEANUP_CRON_JOB,
							serverId: input.serverId,
							type: "server",
						});
					} else {
						scheduleJob(server.serverId, CLEANUP_CRON_JOB, async () => {
							console.log(
								`Docker Cleanup ${new Date().toLocaleString()}] Running...`,
							);

							await cleanupAll(server.serverId);

							await sendDockerCleanupNotifications(server.organizationId);
						});
					}
				} else {
					if (IS_CLOUD) {
						await removeJob({
							cronSchedule: CLEANUP_CRON_JOB,
							serverId: input.serverId,
							type: "server",
						});
					} else {
						const currentJob = scheduledJobs[server.serverId];
						currentJob?.cancel();
					}
				}
			} else if (!IS_CLOUD) {
				const settingsUpdated = await updateWebServerSettings({
					enableDockerCleanup: input.enableDockerCleanup,
				});

				if (settingsUpdated?.enableDockerCleanup) {
					scheduleJob("docker-cleanup", CLEANUP_CRON_JOB, async () => {
						console.log(
							`Docker Cleanup ${new Date().toLocaleString()}] Running...`,
						);

						await cleanupAll();

						await sendDockerCleanupNotifications(ctx.organizationId);
					});
				} else {
					const currentJob = scheduledJobs["docker-cleanup"];
					currentJob?.cancel();
				}
			}

			console.info("[audit] settings.docker-cleanup", {
				action: "update",
				resourceType: "settings",
				resourceName: "docker-cleanup",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SettingsMethod.updateRemoteServersOnly: {
			requireAdmin(ctx);
			const input = decodeArgs<{ remoteServersOnly: boolean }>(call.payload);
			if (IS_CLOUD) {
				throw new BadRequestError(
					"This feature is only available for self-hosted instances",
				);
			}

			await updateWebServerSettings({
				remoteServersOnly: input.remoteServersOnly,
			});

			console.info("[audit] settings.remote-servers-only", {
				action: "update",
				resourceType: "settings",
				resourceName: "remote-servers-only",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SettingsMethod.updateEnforceSSO: {
			requireAdmin(ctx);
			const input = decodeArgs<{ enforceSSO: boolean }>(call.payload);
			if (IS_CLOUD) {
				throw new BadRequestError(
					"This feature is only available for self-hosted instances",
				);
			}

			await updateWebServerSettings({
				enforceSSO: input.enforceSSO,
			});

			console.info("[audit] settings.enforce-sso", {
				action: "update",
				resourceType: "settings",
				resourceName: "enforce-sso",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SettingsMethod.readTraefikConfig: {
			requireAdmin(ctx);
			if (IS_CLOUD) {
				return true;
			}
			const traefikConfig = readMainConfig();
			return traefikConfig;
		}

		case SettingsMethod.updateTraefikConfig: {
			requireAdmin(ctx);
			const input = decodeArgs<{ traefikConfig: string }>(call.payload);
			if (IS_CLOUD) {
				return true;
			}
			writeMainConfig(input.traefikConfig);
			console.info("[audit] settings.traefik-config", {
				action: "update",
				resourceType: "settings",
				resourceName: "traefik-config",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SettingsMethod.readWebServerTraefikConfig: {
			requireAdmin(ctx);
			if (IS_CLOUD) {
				return true;
			}
			const traefikConfig = readConfig("hanzo");
			return traefikConfig;
		}

		case SettingsMethod.updateWebServerTraefikConfig: {
			requireAdmin(ctx);
			const input = decodeArgs<{ traefikConfig: string }>(call.payload);
			if (IS_CLOUD) {
				return true;
			}
			writeConfig("hanzo", input.traefikConfig);
			return true;
		}

		case SettingsMethod.readMiddlewareTraefikConfig: {
			requireAdmin(ctx);
			if (IS_CLOUD) {
				return true;
			}
			const traefikConfig = readConfig("middlewares");
			return traefikConfig;
		}

		case SettingsMethod.updateMiddlewareTraefikConfig: {
			requireAdmin(ctx);
			const input = decodeArgs<{ traefikConfig: string }>(call.payload);
			if (IS_CLOUD) {
				return true;
			}
			writeConfig("middlewares", input.traefikConfig);
			console.info("[audit] settings.middleware-traefik-config", {
				action: "update",
				resourceType: "settings",
				resourceName: "middleware-traefik-config",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SettingsMethod.getUpdateData: {
			requireSession(ctx);
			if (IS_CLOUD) {
				return DEFAULT_UPDATE_DATA;
			}

			return await getUpdateData(packageInfo.version);
		}

		case SettingsMethod.updateServer: {
			requireAdmin(ctx);
			if (IS_CLOUD) {
				return true;
			}

			const data = await getUpdateData(packageInfo.version);
			if (data.updateAvailable) {
				void spawnAsync("docker", [
					"service",
					"update",
					"--force",
					"--image",
					`hanzoai/platform:${data.latestVersion}`,
					"hanzo",
				]);
				console.info("[audit] settings.dokploy-version", {
					action: "update",
					resourceType: "settings",
					resourceName: "dokploy-version",
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
			}

			return true;
		}

		case SettingsMethod.getHanzoVersion: {
			requireSession(ctx);
			return packageInfo.version;
		}

		case SettingsMethod.getReleaseTag: {
			requireSession(ctx);
			return getHanzoImageTag();
		}

		case SettingsMethod.readDirectories: {
			requireSession(ctx);
			// biome-ignore lint/suspicious/noExplicitAny: apiServerSchema input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			try {
				await checkPermission(permCtx(ctx), { traefikFiles: ["read"] });
				const { MAIN_TRAEFIK_PATH } = paths(!!input?.serverId);
				const result = await readDirectory(MAIN_TRAEFIK_PATH, input?.serverId);
				return result || [];
			} catch (error) {
				throw error;
			}
		}

		case SettingsMethod.updateTraefikFile: {
			requireSession(ctx);
			// biome-ignore lint/suspicious/noExplicitAny: apiModifyTraefikConfig input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await checkPermission(permCtx(ctx), { traefikFiles: ["write"] });
			await writeTraefikConfigInPath(
				input.path,
				input.traefikConfig,
				input?.serverId,
			);
			console.info("[audit] settings.traefik-file", {
				action: "update",
				resourceType: "settings",
				resourceName: "traefik-file",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SettingsMethod.readTraefikFile: {
			requireSession(ctx);
			const input = decodeArgs<{ path: string; serverId?: string }>(
				call.payload,
			);
			await checkPermission(permCtx(ctx), { traefikFiles: ["read"] });

			if (input.serverId) {
				const server = await findServerById(input.serverId);

				if (server.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError("");
				}
			}

			return readConfigInPath(input.path, input.serverId);
		}

		case SettingsMethod.getIp: {
			requireSession(ctx);
			if (IS_CLOUD) {
				return "";
			}
			const settings = await getWebServerSettings();
			return settings?.serverIp || "";
		}

		case SettingsMethod.updateServerIp: {
			requireAdmin(ctx);
			const input = decodeArgs<{ serverIp: string }>(call.payload);
			if (IS_CLOUD) {
				return true;
			}
			const settings = await updateWebServerSettings({
				serverIp: input.serverIp,
			});
			console.info("[audit] settings.server-ip", {
				action: "update",
				resourceType: "settings",
				resourceName: "server-ip",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return settings;
		}

		case SettingsMethod.getOpenApiDocument: {
			requireSession(ctx);
			// ctx.req.headers["x-forwarded-proto"] / ctx.req.headers.host were the
			// only tRPC-only ctx reads in the router; they are captured at the mint
			// boundary (reqProto / reqHost) and threaded in here.
			const protocol = ctx.reqProto;
			const url = `${protocol}://${ctx.reqHost}/api`;
			const openApiDocument = generateOpenApiDocument(appRouter, {
				title: "tRPC OpenAPI",
				version: packageInfo.version,
				baseUrl: url,
				docsUrl: `${url}/settings.getOpenApiDocument`,
				tags: [
					"admin",
					"docker",
					"compose",
					"registry",
					"cluster",
					"user",
					"domain",
					"destination",
					"backup",
					"deployment",
					"mounts",
					"certificates",
					"settings",
					"security",
					"redirects",
					"port",
					"project",
					"application",
					"mysql",
					"postgres",
					"redis",
					"mongo",
					"libsql",
					"mariadb",
					"sshRouter",
					"gitProvider",
					"bitbucket",
					"ai",
					"github",
					"gitlab",
					"gitea",
					"tag",
					"patch",
					"server",
					"volumeBackups",
					"environment",
					"auditLog",
					"customRole",
					"whitelabeling",
					"sso",
					"organization",
					"previewDeployment",
				],
			});

			openApiDocument.info = {
				title: "Hanzo Platform API",
				description: "Endpoints for Hanzo Platform",
				version: packageInfo.version,
			};

			// Add security schemes configuration
			openApiDocument.components = {
				...openApiDocument.components,
				securitySchemes: {
					apiKey: {
						type: "apiKey",
						in: "header",
						name: "x-api-key",
						description: "API key authentication",
					},
				},
			};

			// Apply security globally to all endpoints
			openApiDocument.security = [
				{
					apiKey: [],
				},
			];
			return openApiDocument;
		}

		case SettingsMethod.readTraefikEnv: {
			requireAdmin(ctx);
			// biome-ignore lint/suspicious/noExplicitAny: apiServerSchema input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			const envVars = await readEnvironmentVariables(
				"platform-traefik",
				input?.serverId,
			);
			return envVars;
		}

		case SettingsMethod.writeTraefikEnv: {
			requireAdmin(ctx);
			const input = decodeArgs<{ env: string; serverId?: string }>(
				call.payload,
			);
			const envs = prepareEnvironmentVariables(input.env);
			const ports = await readPorts("platform-traefik", input?.serverId);

			// Run in background so the request returns immediately; client polls /v1/health.
			void writeTraefikSetup({
				env: envs,
				additionalPorts: ports,
				serverId: input.serverId,
			}).catch((err) => {
				console.error("writeTraefikEnv background writeTraefikSetup:", err);
			});
			console.info("[audit] settings.traefik-env", {
				action: "update",
				resourceType: "settings",
				resourceName: "traefik-env",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SettingsMethod.haveTraefikDashboardPortEnabled: {
			requireAdmin(ctx);
			// biome-ignore lint/suspicious/noExplicitAny: apiServerSchema input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			const ports = await readPorts("platform-traefik", input?.serverId);
			return ports.some((port) => port.targetPort === 8080);
		}

		case SettingsMethod.readStatsLogs: {
			requireSession(ctx);
			// biome-ignore lint/suspicious/noExplicitAny: apiReadStatsLogs input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			if (IS_CLOUD) {
				return {
					data: [],
					totalCount: 0,
				};
			}
			const rawConfig = await readMonitoringConfig(
				!!input.dateRange?.start && !!input.dateRange?.end,
			);

			const parsedConfig = parseRawConfig(
				rawConfig as string,
				input.page,
				input.sort,
				input.search,
				input.status,
				input.dateRange,
			);

			return parsedConfig;
		}

		case SettingsMethod.readStats: {
			requireAdmin(ctx);
			const input = decodeArgs<{
				dateRange?: { start?: string; end?: string };
			}>(call.payload);
			if (IS_CLOUD) {
				return [];
			}
			const rawConfig = await readMonitoringConfig(
				!!input?.dateRange?.start || !!input?.dateRange?.end,
			);
			const processedLogs = processLogs(rawConfig as string, input?.dateRange);
			return processedLogs || [];
		}

		case SettingsMethod.haveActivateRequests: {
			requireSession(ctx);
			if (IS_CLOUD) {
				return true;
			}
			const config = readMainConfig();

			if (!config) return false;
			const parsedConfig = parse(config) as {
				accessLog?: {
					filePath: string;
				};
			};

			return !!parsedConfig?.accessLog?.filePath;
		}

		case SettingsMethod.toggleRequests: {
			requireSession(ctx);
			const input = decodeArgs<{ enable: boolean }>(call.payload);
			if (IS_CLOUD) {
				return true;
			}
			const mainConfig = readMainConfig();
			if (!mainConfig) return false;

			const currentConfig = parse(mainConfig) as {
				accessLog?: {
					filePath: string;
				};
			};

			if (input.enable) {
				const config = {
					accessLog: {
						filePath: "/etc/platform/traefik/dynamic/access.log",
						format: "json",
						bufferingSize: 100,
					},
				};
				currentConfig.accessLog = config.accessLog;
			} else {
				currentConfig.accessLog = undefined;
			}

			writeMainConfig(stringify(currentConfig));
			console.info("[audit] settings.toggle-requests", {
				action: "update",
				resourceType: "settings",
				resourceName: "toggle-requests",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case SettingsMethod.isCloud: {
			return IS_CLOUD;
		}

		case SettingsMethod.isUserSubscribed: {
			requireSession(ctx);
			const haveServers = await db.query.server.findMany({
				where: eq(server.organizationId, ctx.organizationId || ""),
			});
			const haveProjects = await db.query.projects.findMany({
				where: eq(projects.organizationId, ctx.organizationId || ""),
			});
			return haveServers.length > 0 || haveProjects.length > 0;
		}

		case SettingsMethod.health: {
			try {
				db.get(sql`SELECT 1`);
				return { status: "ok" };
			} catch (error) {
				console.error("Database connection error:", error);
				throw error;
			}
		}

		case SettingsMethod.checkInfrastructureHealth: {
			requireAdmin(ctx);
			if (IS_CLOUD) {
				return {
					postgres: { status: "healthy" as const },
					redis: { status: "healthy" as const },
					traefik: { status: "healthy" as const },
				};
			}

			const [postgres, redis, traefik] = await Promise.all([
				checkPostgresHealth(),
				checkRedisHealth(),
				checkTraefikHealth(),
			]);

			return { postgres, redis, traefik };
		}

		case SettingsMethod.setupGPU: {
			requireAdmin(ctx);
			const input = decodeArgs<{ serverId?: string }>(call.payload);
			if (IS_CLOUD && !input.serverId) {
				throw new Error("Select a server to enable the GPU Setup");
			}

			try {
				await setupGPUSupport(input.serverId);
				console.info("[audit] settings.setup-gpu", {
					action: "update",
					resourceType: "settings",
					resourceName: "setup-gpu",
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return { success: true };
			} catch (error) {
				console.error("GPU Setup Error:", error);
				throw error;
			}
		}

		case SettingsMethod.checkGPUStatus: {
			requireAdmin(ctx);
			const input = decodeArgs<{ serverId?: string }>(call.payload);
			if (IS_CLOUD && !input.serverId) {
				return {
					driverInstalled: false,
					driverVersion: undefined,
					gpuModel: undefined,
					runtimeInstalled: false,
					runtimeConfigured: false,
					cudaSupport: undefined,
					cudaVersion: undefined,
					memoryInfo: undefined,
					availableGPUs: 0,
					swarmEnabled: false,
					gpuResources: 0,
				};
			}

			try {
				return await checkGPUStatus(input.serverId || "");
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Failed to check GPU status";
				throw new BadRequestError(message);
			}
		}

		case SettingsMethod.updateTraefikPorts: {
			requireAdmin(ctx);
			const input = decodeArgs<{
				serverId?: string;
				additionalPorts: Array<{
					targetPort: number;
					publishedPort: number;
					protocol: "tcp" | "udp" | "sctp";
				}>;
			}>(call.payload);
			try {
				if (IS_CLOUD && !input.serverId) {
					throw new UnauthorizedError(
						"Please set a serverId to update Traefik ports",
					);
				}
				const env = await readEnvironmentVariables(
					"platform-traefik",
					input?.serverId,
				);

				for (const port of input.additionalPorts) {
					const portCheck = await checkPortInUse(
						port.publishedPort,
						input.serverId,
					);
					if (portCheck.isInUse) {
						throw new ConflictError(
							`Port ${port.targetPort} is already in use by ${portCheck.conflictingContainer}`,
						);
					}
				}
				const preparedEnv = prepareEnvironmentVariables(env);

				// Run in background so the request returns immediately; client polls /v1/health.
				void writeTraefikSetup({
					env: preparedEnv,
					additionalPorts: input.additionalPorts,
					serverId: input.serverId,
				}).catch((err) => {
					console.error(
						"updateTraefikPorts background writeTraefikSetup:",
						err,
					);
				});
				console.info("[audit] settings.traefik-ports", {
					action: "update",
					resourceType: "settings",
					resourceName: "traefik-ports",
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return true;
			} catch (error) {
				if (
					error instanceof UnauthorizedError ||
					error instanceof ConflictError
				) {
					throw error;
				}
				throw new BadRequestError(
					error instanceof Error
						? error.message
						: "Error updating Traefik ports",
				);
			}
		}

		case SettingsMethod.getTraefikPorts: {
			requireAdmin(ctx);
			// biome-ignore lint/suspicious/noExplicitAny: apiServerSchema input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			const ports = await readPorts("platform-traefik", input?.serverId);
			return ports;
		}

		case SettingsMethod.updateLogCleanup: {
			requireSession(ctx);
			const input = decodeArgs<{ cronExpression: string | null }>(
				call.payload,
			);
			if (IS_CLOUD) {
				return true;
			}
			let result: boolean;
			if (input.cronExpression) {
				result = await startLogCleanup(input.cronExpression);
			} else {
				result = await stopLogCleanup();
			}
			console.info("[audit] settings.log-cleanup", {
				action: "update",
				resourceType: "settings",
				resourceName: "log-cleanup",
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return result;
		}

		case SettingsMethod.getLogCleanupStatus: {
			requireSession(ctx);
			return getLogCleanupStatus();
		}

		case SettingsMethod.getHanzoCloudIps: {
			requireAdmin(ctx);
			// NOTE: DOKPLOY_CLOUD_IPS env var kept for backward compatibility
			if (!IS_CLOUD) {
				return [];
			}
			const ips = (
				process.env.HANZO_CLOUD_IPS ?? process.env.DOKPLOY_CLOUD_IPS
			)?.split(",");
			return ips;
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
