// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// mysql-cap.ts — the native @zap-proto/web Mysql capability.
//
// Binary-ZAP replacement for the tRPC `mysqlRouter`
// (server/api/routers/mysql.ts). Every method was a `protectedProcedure`
// (authenticated caller, session+user) whose body additionally enforces
// per-service permission + org ownership (checkServiceAccess /
// checkServicePermissionAndAccess + an organizationId match). The
// `deployWithLogs` method was a tRPC `.subscription()` async generator yielding
// deploy log lines — it is ported here by collecting the emitted lines into an
// array returned via the shared Result carrier (ZAP is request/response). The
// mint boundary requires session+user (a null return rejects the WS upgrade
// with HTTP 401, mirroring protectedProcedure); the per-service permission and
// org-ownership checks run INSIDE dispatch, verbatim from the original
// procedure bodies. Inputs ride the shared Args carrier, results the shared
// Result carrier; MysqlMethod ordinals are generated from mysql.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// mysql.<action>", …)`, mirroring how registry-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	checkPortInUse,
	createMount,
	createMysql,
	deployMySql,
	execAsync,
	execAsyncRemote,
	findBackupsByDbId,
	findEnvironmentById,
	findMySqlById,
	findProjectById,
	// PRE-EXISTING: getAccessibleServerIds / getContainerLogs were dropped by the
	// Hanzo fork (the tRPC mysqlRouter imports them too and fails identically).
	getAccessibleServerIds,
	getContainerLogs,
	getServiceContainerCommand,
	getWebServerSettings,
	IS_CLOUD,
	rebuildDatabase,
	removeMySqlById,
	removeService,
	startService,
	startServiceRemote,
	stopService,
	stopServiceRemote,
	updateMySqlById,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
	addNewService,
	checkServiceAccess,
	// PRE-EXISTING: checkServicePermissionAndAccess was dropped by the Hanzo fork
	// (the tRPC mysqlRouter references it too and fails identically).
	checkServicePermissionAndAccess,
	findMemberById,
} from "@hanzo/platform";
import {
	// PRE-EXISTING: DATABASE_PASSWORD_MESSAGE / DATABASE_PASSWORD_REGEX are not
	// exported by the Hanzo fork's schema (the tRPC mysqlRouter imports them too).
	DATABASE_PASSWORD_MESSAGE,
	DATABASE_PASSWORD_REGEX,
	environments,
	mysql as mysqlTable,
	projects,
} from "@/server/db/schema";
import { cancelJobs } from "@/server/utils/backup";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { MysqlMethod } from "./schema/mysql_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface MysqlCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * mysqlMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication half: validates the upgrade and requires session+user. Null →
 * HTTP 401 before any socket opens. The per-service permission and
 * org-ownership halves run inside dispatch (verbatim from the bodies).
 */
export const mysqlMintCap: MintCap<MysqlCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as MysqlCtx["userRole"];
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
/** Typed conflict failure → ZAP Status.Internal (no ZAP conflict status). */
class ConflictError extends Error {}

/**
 * The flat MysqlCtx is also the `ctx`-shaped value the permission helpers and
 * `audit` consume: `ctx.session.activeOrganizationId`, `ctx.user.id`,
 * `ctx.session`. We expose those projections so the ported bodies read
 * verbatim against `pctx`.
 */
function permCtx(ctx: MysqlCtx) {
	return {
		...ctx,
		session: {
			activeOrganizationId: ctx.organizationId,
			userId: ctx.userId,
		},
		user: { id: ctx.userId, email: ctx.email, role: ctx.userRole },
	};
}

/**
 * mysqlRootCap — dispatch each decoded Call by MysqlMethod ordinal to the same
 * service functions the tRPC procedure called. Inputs decode via the shared Args
 * carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function mysqlRootCap(ctx: MysqlCtx): CallHandler {
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

async function dispatch(ctx: MysqlCtx, call: Call): Promise<unknown> {
	const pctx = permCtx(ctx);
	switch (call.method) {
		case MysqlMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: apiCreateMySql input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			try {
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
				// webServer settings type (the tRPC mysqlRouter reads it too).
				if (
					(IS_CLOUD || webServerSettings?.remoteServersOnly) &&
					!input.serverId
				) {
					throw new UnauthorizedError(
						"You need to use a server to create a MySQL",
					);
				}

				if (project.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You are not authorized to access this project",
					);
				}

				if (input.serverId) {
					// PRE-EXISTING: getAccessibleServerIds was dropped by the Hanzo fork
					// (the tRPC mysqlRouter calls it with ctx.session too).
					const accessibleIds = await getAccessibleServerIds(pctx.session);
					if (!accessibleIds.has(input.serverId)) {
						throw new UnauthorizedError(
							"You are not authorized to access this server",
						);
					}
				}

				const newMysql = await createMysql({
					...input,
				});
				await addNewService(ctx.userId, newMysql.mysqlId, ctx.organizationId);

				await createMount({
					serviceId: newMysql.mysqlId,
					serviceType: "mysql",
					volumeName: `${newMysql.appName}-data`,
					mountPath: "/var/lib/mysql",
					type: "volume",
				});

				console.info("[audit] mysql.create", {
					action: "create",
					resourceType: "service",
					resourceId: newMysql.mysqlId,
					resourceName: newMysql.appName,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return newMysql;
			} catch (error) {
				if (
					error instanceof UnauthorizedError ||
					error instanceof NotFoundError
				) {
					throw error;
				}
				throw new BadRequestError("Error input: Inserting MySQL database");
			}
		}

		case MysqlMethod.one: {
			const input = decodeArgs<{ mysqlId: string }>(call.payload);
			await checkServiceAccess(
				ctx.userId,
				input.mysqlId,
				ctx.organizationId,
				"access",
			);
			const mysql = await findMySqlById(input.mysqlId);
			if (
				mysql.environment.project.organizationId !== ctx.organizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to access this MySQL",
				);
			}
			return mysql;
		}

		case MysqlMethod.start: {
			const input = decodeArgs<{ mysqlId: string }>(call.payload);
			await checkServicePermissionAndAccess(pctx, input.mysqlId, {
				deployment: ["create"],
			});
			const service = await findMySqlById(input.mysqlId);

			if (service.serverId) {
				await startServiceRemote(service.serverId, service.appName);
			} else {
				await startService(service.appName);
			}
			await updateMySqlById(input.mysqlId, {
				applicationStatus: "done",
			});

			console.info("[audit] mysql.start", {
				action: "start",
				resourceType: "service",
				resourceId: service.mysqlId,
				resourceName: service.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return service;
		}

		case MysqlMethod.stop: {
			const input = decodeArgs<{ mysqlId: string }>(call.payload);
			await checkServicePermissionAndAccess(pctx, input.mysqlId, {
				deployment: ["create"],
			});
			const mongo = await findMySqlById(input.mysqlId);
			if (mongo.serverId) {
				await stopServiceRemote(mongo.serverId, mongo.appName);
			} else {
				await stopService(mongo.appName);
			}
			await updateMySqlById(input.mysqlId, {
				applicationStatus: "idle",
			});

			console.info("[audit] mysql.stop", {
				action: "stop",
				resourceType: "service",
				resourceId: mongo.mysqlId,
				resourceName: mongo.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return mongo;
		}

		case MysqlMethod.saveExternalPort: {
			const input = decodeArgs<{ mysqlId: string; externalPort?: number }>(
				call.payload,
			);
			await checkServicePermissionAndAccess(pctx, input.mysqlId, {
				service: ["create"],
			});
			const mysql = await findMySqlById(input.mysqlId);

			if (input.externalPort) {
				const portCheck = await checkPortInUse(
					input.externalPort,
					mysql.serverId || undefined,
				);
				if (portCheck.isInUse) {
					throw new ConflictError(
						`Port ${input.externalPort} is already in use by ${portCheck.conflictingContainer}`,
					);
				}
			}

			await updateMySqlById(input.mysqlId, {
				externalPort: input.externalPort,
			});
			await deployMySql(input.mysqlId);
			console.info("[audit] mysql.update", {
				action: "update",
				resourceType: "service",
				resourceId: mysql.mysqlId,
				resourceName: mysql.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return mysql;
		}

		case MysqlMethod.deploy: {
			const input = decodeArgs<{ mysqlId: string }>(call.payload);
			await checkServicePermissionAndAccess(pctx, input.mysqlId, {
				deployment: ["create"],
			});
			const mysql = await findMySqlById(input.mysqlId);
			console.info("[audit] mysql.deploy", {
				action: "deploy",
				resourceType: "service",
				resourceId: mysql.mysqlId,
				resourceName: mysql.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return deployMySql(input.mysqlId);
		}

		case MysqlMethod.deployWithLogs: {
			// Ported from the tRPC `.subscription()` async generator: the original
			// `yield`ed each deploy log line to the client over a stream. ZAP
			// requests are request/response, so the emitted log lines are collected
			// into an array and returned via the shared Result carrier rather than
			// streamed. The `signal`-based abort path is dropped (no per-request
			// abort channel in request/response).
			const input = decodeArgs<{ mysqlId: string }>(call.payload);
			await checkServicePermissionAndAccess(pctx, input.mysqlId, {
				deployment: ["create"],
			});

			const queue: string[] = [];
			let done = false;

			deployMySql(input.mysqlId, (log) => {
				queue.push(log);
			})
				.catch(() => {})
				.finally(() => {
					done = true;
				});

			while (!done || queue.length > 0) {
				if (queue.length === 0) {
					await new Promise((r) => setTimeout(r, 50));
				}
			}

			return queue;
		}

		case MysqlMethod.changeStatus: {
			const input = decodeArgs<{
				mysqlId: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiChangeMySqlStatus input, ported verbatim
				applicationStatus: any;
			}>(call.payload);
			await checkServicePermissionAndAccess(pctx, input.mysqlId, {
				deployment: ["create"],
			});
			const mongo = await findMySqlById(input.mysqlId);
			await updateMySqlById(input.mysqlId, {
				applicationStatus: input.applicationStatus,
			});
			console.info("[audit] mysql.update", {
				action: "update",
				resourceType: "service",
				resourceId: mongo.mysqlId,
				resourceName: mongo.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return mongo;
		}

		case MysqlMethod.reload: {
			const input = decodeArgs<{ mysqlId: string }>(call.payload);
			await checkServicePermissionAndAccess(pctx, input.mysqlId, {
				deployment: ["create"],
			});
			const mysql = await findMySqlById(input.mysqlId);
			if (mysql.serverId) {
				await stopServiceRemote(mysql.serverId, mysql.appName);
			} else {
				await stopService(mysql.appName);
			}
			await updateMySqlById(input.mysqlId, {
				applicationStatus: "idle",
			});
			if (mysql.serverId) {
				await startServiceRemote(mysql.serverId, mysql.appName);
			} else {
				await startService(mysql.appName);
			}
			await updateMySqlById(input.mysqlId, {
				applicationStatus: "done",
			});
			console.info("[audit] mysql.reload", {
				action: "reload",
				resourceType: "service",
				resourceId: mysql.mysqlId,
				resourceName: mysql.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case MysqlMethod.remove: {
			const input = decodeArgs<{ mysqlId: string }>(call.payload);
			await checkServiceAccess(
				ctx.userId,
				input.mysqlId,
				ctx.organizationId,
				"delete",
			);
			const mongo = await findMySqlById(input.mysqlId);
			if (
				mongo.environment.project.organizationId !== ctx.organizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to delete this MySQL",
				);
			}

			console.info("[audit] mysql.delete", {
				action: "delete",
				resourceType: "service",
				resourceId: mongo.mysqlId,
				resourceName: mongo.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			const backups = await findBackupsByDbId(input.mysqlId, "mysql");
			const cleanupOperations = [
				async () => await removeService(mongo?.appName, mongo.serverId),
				async () => await cancelJobs(backups),
				async () => await removeMySqlById(input.mysqlId),
			];

			for (const operation of cleanupOperations) {
				try {
					await operation();
				} catch (_) {}
			}

			return mongo;
		}

		case MysqlMethod.saveEnvironment: {
			const input = decodeArgs<{ mysqlId: string; env?: string }>(
				call.payload,
			);
			await checkServicePermissionAndAccess(pctx, input.mysqlId, {
				envVars: ["write"],
			});
			const service = await updateMySqlById(input.mysqlId, {
				env: input.env,
			});

			if (!service) {
				throw new BadRequestError("Error adding environment variables");
			}

			console.info("[audit] mysql.update", {
				action: "update",
				resourceType: "service",
				resourceId: input.mysqlId,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case MysqlMethod.update: {
			const input = decodeArgs<{
				mysqlId: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiUpdateMySql input, ported verbatim
				[k: string]: any;
			}>(call.payload);
			const { mysqlId, ...rest } = input;
			await checkServicePermissionAndAccess(pctx, mysqlId, {
				service: ["create"],
			});
			const service = await updateMySqlById(mysqlId, {
				...rest,
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
			} as any);

			if (!service) {
				throw new BadRequestError("Update: Error updating MySQL");
			}

			console.info("[audit] mysql.update", {
				action: "update",
				resourceType: "service",
				resourceId: mysqlId,
				resourceName: service.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case MysqlMethod.changePassword: {
			const input = decodeArgs<{
				mysqlId: string;
				password: string;
				type?: "user" | "root";
			}>(call.payload);
			const { mysqlId, password, type } = input;
			await checkServicePermissionAndAccess(pctx, mysqlId, {
				service: ["create"],
			});

			const my = await findMySqlById(mysqlId);
			const { appName, serverId, databaseUser, databaseRootPassword } = my;

			const containerCmd = getServiceContainerCommand(appName);
			const targetUser = type === "root" ? "root" : databaseUser;

			const command = `
				CONTAINER_ID=$(${containerCmd})
				if [ -z "$CONTAINER_ID" ]; then
					echo "No running container found for ${appName}" >&2
					exit 1
				fi
				docker exec "$CONTAINER_ID" mysql -u root -p'${databaseRootPassword}' -e "ALTER USER '${targetUser}'@'%' IDENTIFIED BY '${password}'; FLUSH PRIVILEGES;"
			`;

			await db.transaction(async (tx) => {
				const setData =
					type === "root"
						? { databaseRootPassword: password }
						: { databasePassword: password };
				await tx
					.update(mysqlTable)
					.set(setData)
					.where(eq(mysqlTable.mysqlId, mysqlId));

				if (serverId) {
					await execAsyncRemote(serverId, command);
				} else {
					await execAsync(command, { shell: "/bin/bash" });
				}
			});

			console.info("[audit] mysql.update", {
				action: "update",
				resourceType: "service",
				resourceId: mysqlId,
				resourceName: appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});

			return true;
		}

		case MysqlMethod.move: {
			const input = decodeArgs<{
				mysqlId: string;
				targetEnvironmentId: string;
			}>(call.payload);
			await checkServicePermissionAndAccess(pctx, input.mysqlId, {
				service: ["create"],
			});

			const updatedMysql = await db
				.update(mysqlTable)
				.set({
					environmentId: input.targetEnvironmentId,
				})
				.where(eq(mysqlTable.mysqlId, input.mysqlId))
				.returning()
				.then((res) => res[0]);

			if (!updatedMysql) {
				throw new Error("Failed to move mysql");
			}

			console.info("[audit] mysql.move", {
				action: "move",
				resourceType: "service",
				resourceId: updatedMysql.mysqlId,
				resourceName: updatedMysql.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return updatedMysql;
		}

		case MysqlMethod.rebuild: {
			const input = decodeArgs<{ mysqlId: string }>(call.payload);
			await checkServicePermissionAndAccess(pctx, input.mysqlId, {
				deployment: ["create"],
			});

			await rebuildDatabase(input.mysqlId, "mysql");

			console.info("[audit] mysql.rebuild", {
				action: "rebuild",
				resourceType: "service",
				resourceId: input.mysqlId,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case MysqlMethod.search: {
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
				baseConditions.push(eq(mysqlTable.environmentId, input.environmentId));
			}
			if (input.q?.trim()) {
				const term = `%${input.q.trim()}%`;
				baseConditions.push(
					or(
						ilike(mysqlTable.name, term),
						ilike(mysqlTable.appName, term),
						ilike(mysqlTable.description ?? "", term),
					)!,
				);
			}
			if (input.name?.trim()) {
				baseConditions.push(ilike(mysqlTable.name, `%${input.name.trim()}%`));
			}
			if (input.appName?.trim()) {
				baseConditions.push(
					ilike(mysqlTable.appName, `%${input.appName.trim()}%`),
				);
			}
			if (input.description?.trim()) {
				baseConditions.push(
					ilike(mysqlTable.description ?? "", `%${input.description.trim()}%`),
				);
			}
			const { accessedServices } = await findMemberById(
				ctx.userId,
				ctx.organizationId,
			);
			if (accessedServices.length === 0) return { items: [], total: 0 };
			baseConditions.push(
				sql`${mysqlTable.mysqlId} IN (${sql.join(
					accessedServices.map((id: string) => sql`${id}`),
					sql`, `,
				)})`,
			);

			const where = and(...baseConditions);
			const [items, countResult] = await Promise.all([
				db
					.select({
						mysqlId: mysqlTable.mysqlId,
						name: mysqlTable.name,
						appName: mysqlTable.appName,
						description: mysqlTable.description,
						environmentId: mysqlTable.environmentId,
						applicationStatus: mysqlTable.applicationStatus,
						createdAt: mysqlTable.createdAt,
					})
					.from(mysqlTable)
					.innerJoin(
						environments,
						eq(mysqlTable.environmentId, environments.environmentId),
					)
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(where)
					.orderBy(desc(mysqlTable.createdAt))
					.limit(limit)
					.offset(offset),
				db
					.select({ count: sql<number>`count(*)::int` })
					.from(mysqlTable)
					.innerJoin(
						environments,
						eq(mysqlTable.environmentId, environments.environmentId),
					)
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(where),
			]);
			return { items, total: countResult[0]?.count ?? 0 };
		}

		case MysqlMethod.readLogs: {
			const input = decodeArgs<{
				mysqlId: string;
				tail?: number;
				since?: string;
				search?: string;
			}>(call.payload);
			const tail = input.tail ?? 100;
			const since = input.since ?? "all";
			await checkServiceAccess(
				ctx.userId,
				input.mysqlId,
				ctx.organizationId,
				"access",
			);
			const mysql = await findMySqlById(input.mysqlId);
			if (
				mysql.environment.project.organizationId !== ctx.organizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to access this MySQL",
				);
			}
			return await getContainerLogs(
				mysql.appName,
				tail,
				since,
				input.search,
				mysql.serverId,
			);
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
