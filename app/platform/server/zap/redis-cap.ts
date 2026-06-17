// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// redis-cap.ts — the native @zap-proto/web Redis capability.
//
// Binary-ZAP replacement for the tRPC `redisRouter`
// (server/api/routers/redis.ts). Every method was a `protectedProcedure`
// (authenticated caller, session+user) whose body additionally enforces
// per-redis org ownership — either via checkServiceAccess /
// checkServicePermissionAndAccess or an explicit organizationId comparison
// against `redis.environment.project.organizationId`. `deployWithLogs` was a
// tRPC `.subscription()` (async generator) yielding deploy log lines — it is
// ported verbatim with the yielded log lines collected into an array returned
// via the shared Result carrier. The mint boundary requires session+user (a
// null return rejects the WS upgrade with HTTP 401, mirroring
// protectedProcedure); the per-redis ownership checks run INSIDE dispatch,
// verbatim from the original procedure bodies. Inputs ride the shared Args
// carrier, results the shared Result carrier; RedisMethod ordinals are
// generated from redis.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// redis.<action>", …)`, mirroring how backup-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	addNewService,
	checkPortInUse,
	checkServiceAccess,
	// PRE-EXISTING: checkServicePermissionAndAccess was dropped by the Hanzo fork
	// (the tRPC redisRouter references it too and fails identically).
	checkServicePermissionAndAccess,
	createMount,
	createRedis,
	deployRedis,
	execAsync,
	execAsyncRemote,
	findEnvironmentById,
	findMemberById,
	findProjectById,
	findRedisById,
	// PRE-EXISTING: getAccessibleServerIds / getContainerLogs were dropped by the
	// Hanzo fork (the tRPC redisRouter imports them too and fails identically).
	getAccessibleServerIds,
	getContainerLogs,
	getServiceContainerCommand,
	getWebServerSettings,
	IS_CLOUD,
	rebuildDatabase,
	removeRedisById,
	removeService,
	startService,
	startServiceRemote,
	stopService,
	stopServiceRemote,
	updateRedisById,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
	// PRE-EXISTING: DATABASE_PASSWORD_MESSAGE / DATABASE_PASSWORD_REGEX are not
	// exported by the Hanzo fork's schema (the tRPC redisRouter imports them too).
	DATABASE_PASSWORD_MESSAGE,
	DATABASE_PASSWORD_REGEX,
	environments,
	projects,
	redis as redisTable,
} from "@/server/db/schema";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { RedisMethod } from "./schema/redis_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface RedisCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * redisMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication half: validates the upgrade and requires session+user. Null →
 * HTTP 401 before any socket opens. The per-redis org-ownership half runs inside
 * dispatch (verbatim from the bodies).
 */
export const redisMintCap: MintCap<RedisCtx> = async (req: IncomingMessage) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as RedisCtx["userRole"];
	const userId = (user as { id?: string }).id || "";
	const email = (user as { email?: string }).email || "";
	return { organizationId, userRole, userId, email };
};

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}
/** Typed conflict failure → ZAP Status.Internal-mapped via tRPC CONFLICT. */
class ConflictError extends Error {}

/**
 * redisRootCap — dispatch each decoded Call by RedisMethod ordinal to the same
 * service functions the tRPC procedure called. Inputs decode via the shared Args
 * carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function redisRootCap(ctx: RedisCtx): CallHandler {
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

async function dispatch(ctx: RedisCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case RedisMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: apiCreateRedis input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			const environment = await findEnvironmentById(input.environmentId);
			const project = await findProjectById(environment.projectId);

			await checkServiceAccess(
				ctx.userId,
				project.projectId,
				ctx.organizationId,
				"create",
			);

			const webServerSettings = await getWebServerSettings();
			// PRE-EXISTING: `remoteServersOnly` is absent from the Hanzo fork's
			// webServer settings type (the tRPC redisRouter reads it too).
			if (
				(IS_CLOUD || webServerSettings?.remoteServersOnly) &&
				!input.serverId
			) {
				throw new UnauthorizedError("You need to use a server to create a Redis");
			}

			if (project.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not authorized to access this project",
				);
			}

			if (input.serverId) {
				// PRE-EXISTING: getAccessibleServerIds was dropped by the Hanzo fork
				// (the tRPC redisRouter calls it with ctx.session too).
				const accessibleIds = await getAccessibleServerIds(ctx.session);
				if (!accessibleIds.has(input.serverId)) {
					throw new UnauthorizedError(
						"You are not authorized to access this server",
					);
				}
			}

			const newRedis = await createRedis({
				...input,
			});
			await addNewService(ctx.userId, newRedis.redisId, ctx.organizationId);

			await createMount({
				serviceId: newRedis.redisId,
				serviceType: "redis",
				volumeName: `${newRedis.appName}-data`,
				mountPath: "/data",
				type: "volume",
			});

			console.info("[audit] redis.create", {
				action: "create",
				resourceType: "service",
				resourceId: newRedis.redisId,
				resourceName: newRedis.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return newRedis;
		}

		case RedisMethod.one: {
			const input = decodeArgs<{ redisId: string }>(call.payload);
			await checkServiceAccess(
				ctx.userId,
				input.redisId,
				ctx.organizationId,
				"access",
			);

			const redis = await findRedisById(input.redisId);
			if (redis.environment.project.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not authorized to access this Redis",
				);
			}
			return redis;
		}

		case RedisMethod.start: {
			const input = decodeArgs<{ redisId: string }>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.redisId, {
				deployment: ["create"],
			});
			const redis = await findRedisById(input.redisId);

			if (redis.serverId) {
				await startServiceRemote(redis.serverId, redis.appName);
			} else {
				await startService(redis.appName);
			}
			await updateRedisById(input.redisId, {
				applicationStatus: "done",
			});

			console.info("[audit] redis.start", {
				action: "start",
				resourceType: "service",
				resourceId: redis.redisId,
				resourceName: redis.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return redis;
		}

		case RedisMethod.reload: {
			const input = decodeArgs<{ redisId: string }>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.redisId, {
				deployment: ["create"],
			});
			const redis = await findRedisById(input.redisId);
			if (redis.serverId) {
				await stopServiceRemote(redis.serverId, redis.appName);
			} else {
				await stopService(redis.appName);
			}
			await updateRedisById(input.redisId, {
				applicationStatus: "idle",
			});

			if (redis.serverId) {
				await startServiceRemote(redis.serverId, redis.appName);
			} else {
				await startService(redis.appName);
			}
			await updateRedisById(input.redisId, {
				applicationStatus: "done",
			});
			console.info("[audit] redis.reload", {
				action: "reload",
				resourceType: "service",
				resourceId: redis.redisId,
				resourceName: redis.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case RedisMethod.stop: {
			const input = decodeArgs<{ redisId: string }>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.redisId, {
				deployment: ["create"],
			});
			const redis = await findRedisById(input.redisId);
			if (redis.serverId) {
				await stopServiceRemote(redis.serverId, redis.appName);
			} else {
				await stopService(redis.appName);
			}
			await updateRedisById(input.redisId, {
				applicationStatus: "idle",
			});

			console.info("[audit] redis.stop", {
				action: "stop",
				resourceType: "service",
				resourceId: redis.redisId,
				resourceName: redis.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return redis;
		}

		case RedisMethod.saveExternalPort: {
			const input = decodeArgs<{ redisId: string; externalPort?: number }>(
				call.payload,
			);
			await checkServicePermissionAndAccess(ctx, input.redisId, {
				service: ["create"],
			});
			const redis = await findRedisById(input.redisId);

			if (input.externalPort) {
				const portCheck = await checkPortInUse(
					input.externalPort,
					redis.serverId || undefined,
				);
				if (portCheck.isInUse) {
					throw new ConflictError(
						`Port ${input.externalPort} is already in use by ${portCheck.conflictingContainer}`,
					);
				}
			}

			await updateRedisById(input.redisId, {
				externalPort: input.externalPort,
			});
			await deployRedis(input.redisId);
			console.info("[audit] redis.update", {
				action: "update",
				resourceType: "service",
				resourceId: redis.redisId,
				resourceName: redis.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return redis;
		}

		case RedisMethod.deploy: {
			const input = decodeArgs<{ redisId: string }>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.redisId, {
				deployment: ["create"],
			});
			const redis = await findRedisById(input.redisId);
			console.info("[audit] redis.deploy", {
				action: "deploy",
				resourceType: "service",
				resourceId: redis.redisId,
				resourceName: redis.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return deployRedis(input.redisId);
		}

		case RedisMethod.deployWithLogs: {
			// Ported verbatim from the tRPC `.subscription()` async generator: the
			// original `yield`ed deploy log lines to the client over a WS
			// subscription. ZAP requests are request/response, so the log lines are
			// collected into an array and returned via the shared Result carrier
			// rather than streamed. The abort `signal` half of the generator has no
			// analog in a single request/response call and is dropped; deployment
			// runs to completion and all queued lines are returned.
			const input = decodeArgs<{ redisId: string }>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.redisId, {
				deployment: ["create"],
			});
			const logs: string[] = [];

			await deployRedis(input.redisId, (log) => {
				logs.push(log);
			}).catch(() => {});

			return logs;
		}

		case RedisMethod.changeStatus: {
			const input = decodeArgs<{
				redisId: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiChangeRedisStatus input, ported verbatim
				applicationStatus: any;
			}>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.redisId, {
				deployment: ["create"],
			});
			const mongo = await findRedisById(input.redisId);
			await updateRedisById(input.redisId, {
				applicationStatus: input.applicationStatus,
			});
			console.info("[audit] redis.update", {
				action: "update",
				resourceType: "service",
				resourceId: mongo.redisId,
				resourceName: mongo.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return mongo;
		}

		case RedisMethod.remove: {
			const input = decodeArgs<{ redisId: string }>(call.payload);
			await checkServiceAccess(
				ctx.userId,
				input.redisId,
				ctx.organizationId,
				"delete",
			);

			const redis = await findRedisById(input.redisId);

			if (redis.environment.project.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not authorized to delete this Redis",
				);
			}
			console.info("[audit] redis.delete", {
				action: "delete",
				resourceType: "service",
				resourceId: redis.redisId,
				resourceName: redis.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			const cleanupOperations = [
				async () => await removeService(redis?.appName, redis.serverId),
				async () => await removeRedisById(input.redisId),
			];

			for (const operation of cleanupOperations) {
				try {
					await operation();
				} catch (_) {}
			}

			return redis;
		}

		case RedisMethod.saveEnvironment: {
			const input = decodeArgs<{ redisId: string; env?: string }>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.redisId, {
				envVars: ["write"],
			});
			const updatedRedis = await updateRedisById(input.redisId, {
				env: input.env,
			});

			if (!updatedRedis) {
				throw new BadRequestError("Error adding environment variables");
			}

			console.info("[audit] redis.update", {
				action: "update",
				resourceType: "service",
				resourceId: input.redisId,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case RedisMethod.update: {
			const input = decodeArgs<{
				redisId: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiUpdateRedis input, ported verbatim
				[k: string]: any;
			}>(call.payload);
			const { redisId, ...rest } = input;
			await checkServicePermissionAndAccess(ctx, redisId, {
				service: ["create"],
			});
			const redis = await updateRedisById(redisId, {
				...rest,
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
			} as any);

			if (!redis) {
				throw new BadRequestError("Error updating Redis");
			}

			console.info("[audit] redis.update", {
				action: "update",
				resourceType: "service",
				resourceId: redisId,
				resourceName: redis.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case RedisMethod.changePassword: {
			const input = decodeArgs<{ redisId: string; password: string }>(
				call.payload,
			);
			// Input validation ported from the tRPC Zod schema:
			// password must be non-empty and match DATABASE_PASSWORD_REGEX.
			if (!input.redisId || input.redisId.length < 1) {
				throw new BadRequestError("redisId is required");
			}
			if (
				!input.password ||
				input.password.length < 1 ||
				!DATABASE_PASSWORD_REGEX.test(input.password)
			) {
				throw new BadRequestError(DATABASE_PASSWORD_MESSAGE);
			}
			const { redisId, password } = input;
			await checkServicePermissionAndAccess(ctx, redisId, {
				service: ["create"],
			});

			const rd = await findRedisById(redisId);
			const { appName, serverId, databasePassword } = rd;

			const containerCmd = getServiceContainerCommand(appName);
			const command = `
				CONTAINER_ID=$(${containerCmd})
				if [ -z "$CONTAINER_ID" ]; then
					echo "No running container found for ${appName}" >&2
					exit 1
				fi
				docker exec "$CONTAINER_ID" redis-cli -a '${databasePassword}' CONFIG SET requirepass '${password}'
			`;

			await db.transaction(async (tx) => {
				await tx
					.update(redisTable)
					.set({ databasePassword: password })
					.where(eq(redisTable.redisId, redisId));

				if (serverId) {
					await execAsyncRemote(serverId, command);
				} else {
					await execAsync(command, { shell: "/bin/bash" });
				}
			});

			console.info("[audit] redis.update", {
				action: "update",
				resourceType: "service",
				resourceId: redisId,
				resourceName: appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});

			return true;
		}

		case RedisMethod.move: {
			const input = decodeArgs<{ redisId: string; targetEnvironmentId: string }>(
				call.payload,
			);
			await checkServicePermissionAndAccess(ctx, input.redisId, {
				service: ["create"],
			});

			const updatedRedis = await db
				.update(redisTable)
				.set({
					environmentId: input.targetEnvironmentId,
				})
				.where(eq(redisTable.redisId, input.redisId))
				.returning()
				.then((res) => res[0]);

			if (!updatedRedis) {
				throw new BadRequestError("Failed to move redis");
			}

			console.info("[audit] redis.move", {
				action: "move",
				resourceType: "service",
				resourceId: updatedRedis.redisId,
				resourceName: updatedRedis.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return updatedRedis;
		}

		case RedisMethod.rebuild: {
			const input = decodeArgs<{ redisId: string }>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.redisId, {
				deployment: ["create"],
			});

			await rebuildDatabase(input.redisId, "redis");
			console.info("[audit] redis.rebuild", {
				action: "rebuild",
				resourceType: "service",
				resourceId: input.redisId,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case RedisMethod.search: {
			const input = decodeArgs<{
				q?: string;
				name?: string;
				appName?: string;
				description?: string;
				projectId?: string;
				environmentId?: string;
				limit?: number;
				offset?: number;
			}>(call.payload);
			const limit = input.limit ?? 20;
			const offset = input.offset ?? 0;
			const baseConditions = [
				eq(projects.organizationId, ctx.organizationId),
			];
			if (input.projectId) {
				baseConditions.push(eq(environments.projectId, input.projectId));
			}
			if (input.environmentId) {
				baseConditions.push(eq(redisTable.environmentId, input.environmentId));
			}
			if (input.q?.trim()) {
				const term = `%${input.q.trim()}%`;
				baseConditions.push(
					or(
						ilike(redisTable.name, term),
						ilike(redisTable.appName, term),
						ilike(redisTable.description ?? "", term),
					)!,
				);
			}
			if (input.name?.trim()) {
				baseConditions.push(ilike(redisTable.name, `%${input.name.trim()}%`));
			}
			if (input.appName?.trim()) {
				baseConditions.push(
					ilike(redisTable.appName, `%${input.appName.trim()}%`),
				);
			}
			if (input.description?.trim()) {
				baseConditions.push(
					ilike(redisTable.description ?? "", `%${input.description.trim()}%`),
				);
			}
			const { accessedServices } = await findMemberById(
				ctx.userId,
				ctx.organizationId,
			);
			if (accessedServices.length === 0) return { items: [], total: 0 };
			baseConditions.push(
				sql`${redisTable.redisId} IN (${sql.join(
					accessedServices.map((id: string) => sql`${id}`),
					sql`, `,
				)})`,
			);

			const where = and(...baseConditions);
			const [items, countResult] = await Promise.all([
				db
					.select({
						redisId: redisTable.redisId,
						name: redisTable.name,
						appName: redisTable.appName,
						description: redisTable.description,
						environmentId: redisTable.environmentId,
						applicationStatus: redisTable.applicationStatus,
						createdAt: redisTable.createdAt,
					})
					.from(redisTable)
					.innerJoin(
						environments,
						eq(redisTable.environmentId, environments.environmentId),
					)
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(where)
					.orderBy(desc(redisTable.createdAt))
					.limit(limit)
					.offset(offset),
				db
					.select({ count: sql<number>`count(*)::int` })
					.from(redisTable)
					.innerJoin(
						environments,
						eq(redisTable.environmentId, environments.environmentId),
					)
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(where),
			]);
			return { items, total: countResult[0]?.count ?? 0 };
		}

		case RedisMethod.readLogs: {
			const input = decodeArgs<{
				redisId: string;
				tail?: number;
				since?: string;
				search?: string;
			}>(call.payload);
			await checkServiceAccess(
				ctx.userId,
				input.redisId,
				ctx.organizationId,
				"access",
			);
			const redis = await findRedisById(input.redisId);
			if (redis.environment.project.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not authorized to access this Redis",
				);
			}
			return await getContainerLogs(
				redis.appName,
				input.tail ?? 100,
				input.since ?? "all",
				input.search,
				redis.serverId,
			);
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
