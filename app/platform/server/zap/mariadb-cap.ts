// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// mariadb-cap.ts — the native @zap-proto/web Mariadb capability.
//
// Binary-ZAP replacement for the tRPC `mariadbRouter`
// (server/api/routers/mariadb.ts). Every method was a `protectedProcedure`
// (authenticated caller, session+user) whose body additionally enforces
// per-service org ownership via checkServiceAccess /
// checkServicePermissionAndAccess plus an explicit organizationId match.
// `deployWithLogs` was a tRPC `.subscription()` returning an observable of log
// lines — it is ported verbatim with the emitted log lines collected into an
// array returned via the shared Result carrier. The mint boundary requires
// session+user (a null return rejects the WS upgrade with HTTP 401, mirroring
// protectedProcedure); the per-service ownership checks run INSIDE dispatch,
// verbatim from the original procedure bodies. Inputs ride the shared Args
// carrier, results the shared Result carrier; MariadbMethod ordinals are
// generated from mariadb.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// mariadb.<action>", …)`, mirroring how backup-cap.ts ported its audit. The
// per-service permission helpers (`checkServiceAccess`,
// `checkServicePermissionAndAccess`, `addNewService`) take `ctx` directly — the
// minted ctx carries the `{ session: { userId, activeOrganizationId }, user: {
// id, role, email } }` shape those helpers expect (project-cap.ts precedent), so
// every procedure body is ported verbatim.

import type { IncomingMessage } from "node:http";
import {
	checkPortInUse,
	checkServiceAccess,
	createMariadb,
	createMount,
	deployMariadb,
	execAsync,
	execAsyncRemote,
	findBackupsByDbId,
	findEnvironmentById,
	findMariadbById,
	findMemberById,
	findProjectById,
	// PRE-EXISTING: getAccessibleServerIds dropped by the Hanzo fork (the tRPC mariadbRouter references it too)
	getAccessibleServerIds,
	// PRE-EXISTING: getContainerLogs dropped by the Hanzo fork (the tRPC mariadbRouter references it too)
	getContainerLogs,
	getServiceContainerCommand,
	getWebServerSettings,
	IS_CLOUD,
	addNewService,
	rebuildDatabase,
	removeMariadbById,
	removeService,
	startService,
	startServiceRemote,
	stopService,
	stopServiceRemote,
	updateMariadbById,
} from "@hanzo/platform";
// PRE-EXISTING: services/permission not re-exported at the @hanzo/platform root
// by the Hanzo fork; import checkServicePermissionAndAccess from its subpath
// (mirrors mongo-cap.ts).
import { checkServicePermissionAndAccess } from "@hanzo/platform/services/permission";
import { db } from "@hanzo/platform/db";
import {
	environments,
	mariadb as mariadbTable,
	projects,
} from "@hanzo/platform/db/schema";
import { validateRequest } from "@hanzo/platform/lib/auth";
import { cancelJobs } from "@/server/utils/backup";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { MariadbMethod } from "./schema/mariadb_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface MariadbCtx {
	session: { userId: string; activeOrganizationId: string };
	user: {
		id: string;
		role: "owner" | "member" | "admin";
		email: string;
	};
}

/**
 * mariadbMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication half: validates the upgrade and requires session+user. Null →
 * HTTP 401 before any socket opens. The per-service org-ownership half runs
 * inside dispatch (verbatim from the bodies).
 */
export const mariadbMintCap: MintCap<MariadbCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const activeOrganizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const id = (user as { id?: string }).id || "";
	const role = ((user as { role?: string }).role ??
		"member") as MariadbCtx["user"]["role"];
	const email = (user as { email?: string }).email || "";
	return {
		session: { userId: id, activeOrganizationId },
		user: { id, role, email },
	};
};

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}
/** Typed conflict failure → ZAP Status.Internal (no dedicated conflict status). */
class ConflictError extends Error {}

/**
 * mariadbRootCap — dispatch each decoded Call by MariadbMethod ordinal to the
 * same service functions the tRPC procedure called. Inputs decode via the shared
 * Args carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function mariadbRootCap(ctx: MariadbCtx): CallHandler {
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

async function dispatch(ctx: MariadbCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case MariadbMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: apiCreateMariaDB input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			try {
				const environment = await findEnvironmentById(input.environmentId);
				const project = await findProjectById(environment.projectId);

				await checkServiceAccess(
					ctx.user.id,
					project.projectId,
					ctx.session.activeOrganizationId,
					"create",
				);

				const webServerSettings = await getWebServerSettings();
				if (
					// PRE-EXISTING: remoteServersOnly dropped by the Hanzo fork (the tRPC mariadbRouter references it too)
					(IS_CLOUD || webServerSettings?.remoteServersOnly) &&
					!input.serverId
				) {
					throw new UnauthorizedError(
						"You need to use a server to create a Mariadb",
					);
				}

				if (project.organizationId !== ctx.session.activeOrganizationId) {
					throw new UnauthorizedError(
						"You are not authorized to access this project",
					);
				}

				if (input.serverId) {
					const accessibleIds = await getAccessibleServerIds(ctx.session);
					if (!accessibleIds.has(input.serverId)) {
						throw new UnauthorizedError(
							"You are not authorized to access this server",
						);
					}
				}

				const newMariadb = await createMariadb({
					...input,
				});
				await addNewService(
					ctx.user.id,
					newMariadb.mariadbId,
					ctx.session.activeOrganizationId,
				);

				await createMount({
					serviceId: newMariadb.mariadbId,
					serviceType: "mariadb",
					volumeName: `${newMariadb.appName}-data`,
					mountPath: "/var/lib/mysql",
					type: "volume",
				});

				console.info("[audit] mariadb.create", {
					action: "create",
					resourceType: "service",
					resourceId: newMariadb.mariadbId,
					resourceName: newMariadb.appName,
					organizationId: ctx.session.activeOrganizationId,
					userId: ctx.user.id,
					userEmail: ctx.user.email,
				});
				return newMariadb;
			} catch (error) {
				if (error instanceof UnauthorizedError) {
					throw error;
				}
				throw error;
			}
		}

		case MariadbMethod.one: {
			const input = decodeArgs<{ mariadbId: string }>(call.payload);
			await checkServiceAccess(
				ctx.user.id,
				input.mariadbId,
				ctx.session.activeOrganizationId,
				"access",
			);
			const mariadb = await findMariadbById(input.mariadbId);
			if (
				mariadb.environment.project.organizationId !==
				ctx.session.activeOrganizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to access this Mariadb",
				);
			}
			return mariadb;
		}

		case MariadbMethod.start: {
			const input = decodeArgs<{ mariadbId: string }>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mariadbId, {
				deployment: ["create"],
			});
			const service = await findMariadbById(input.mariadbId);
			if (service.serverId) {
				await startServiceRemote(service.serverId, service.appName);
			} else {
				await startService(service.appName);
			}
			await updateMariadbById(input.mariadbId, {
				applicationStatus: "done",
			});

			console.info("[audit] mariadb.start", {
				action: "start",
				resourceType: "service",
				resourceId: service.mariadbId,
				resourceName: service.appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
				userEmail: ctx.user.email,
			});
			return service;
		}

		case MariadbMethod.stop: {
			const input = decodeArgs<{ mariadbId: string }>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mariadbId, {
				deployment: ["create"],
			});
			const mariadb = await findMariadbById(input.mariadbId);

			if (mariadb.serverId) {
				await stopServiceRemote(mariadb.serverId, mariadb.appName);
			} else {
				await stopService(mariadb.appName);
			}
			await updateMariadbById(input.mariadbId, {
				applicationStatus: "idle",
			});

			console.info("[audit] mariadb.stop", {
				action: "stop",
				resourceType: "service",
				resourceId: mariadb.mariadbId,
				resourceName: mariadb.appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
				userEmail: ctx.user.email,
			});
			return mariadb;
		}

		case MariadbMethod.saveExternalPort: {
			const input = decodeArgs<{
				mariadbId: string;
				externalPort?: number | null;
			}>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mariadbId, {
				service: ["create"],
			});
			const mariadb = await findMariadbById(input.mariadbId);

			if (input.externalPort) {
				const portCheck = await checkPortInUse(
					input.externalPort,
					mariadb.serverId || undefined,
				);
				if (portCheck.isInUse) {
					throw new ConflictError(
						`Port ${input.externalPort} is already in use by ${portCheck.conflictingContainer}`,
					);
				}
			}

			await updateMariadbById(input.mariadbId, {
				externalPort: input.externalPort,
			});
			await deployMariadb(input.mariadbId);
			console.info("[audit] mariadb.update", {
				action: "update",
				resourceType: "service",
				resourceId: mariadb.mariadbId,
				resourceName: mariadb.appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
				userEmail: ctx.user.email,
			});
			return mariadb;
		}

		case MariadbMethod.deploy: {
			const input = decodeArgs<{ mariadbId: string }>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mariadbId, {
				deployment: ["create"],
			});
			const mariadb = await findMariadbById(input.mariadbId);

			console.info("[audit] mariadb.deploy", {
				action: "deploy",
				resourceType: "service",
				resourceId: mariadb.mariadbId,
				resourceName: mariadb.appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
				userEmail: ctx.user.email,
			});
			return deployMariadb(input.mariadbId);
		}

		case MariadbMethod.deployWithLogs: {
			// Ported verbatim from the tRPC `.subscription()`: the original returned
			// an `observable<string>` whose `emit.next(log)` streamed deploy log
			// lines to the client. ZAP requests are request/response, so the emitted
			// log lines are collected into an array and returned via the shared
			// Result carrier rather than streamed.
			const input = decodeArgs<{ mariadbId: string }>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mariadbId, {
				deployment: ["create"],
			});

			const logs: string[] = [];
			await deployMariadb(input.mariadbId, (log) => {
				logs.push(log);
			});
			return logs;
		}

		case MariadbMethod.changeStatus: {
			const input = decodeArgs<{
				mariadbId: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiChangeMariaDBStatus input, ported verbatim
				applicationStatus: any;
			}>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mariadbId, {
				deployment: ["create"],
			});
			const mongo = await findMariadbById(input.mariadbId);
			await updateMariadbById(input.mariadbId, {
				applicationStatus: input.applicationStatus,
			});
			console.info("[audit] mariadb.update", {
				action: "update",
				resourceType: "service",
				resourceId: mongo.mariadbId,
				resourceName: mongo.appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
				userEmail: ctx.user.email,
			});
			return mongo;
		}

		case MariadbMethod.remove: {
			const input = decodeArgs<{ mariadbId: string }>(call.payload);
			await checkServiceAccess(
				ctx.user.id,
				input.mariadbId,
				ctx.session.activeOrganizationId,
				"delete",
			);

			const mongo = await findMariadbById(input.mariadbId);
			if (
				mongo.environment.project.organizationId !==
				ctx.session.activeOrganizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to delete this Mariadb",
				);
			}

			console.info("[audit] mariadb.delete", {
				action: "delete",
				resourceType: "service",
				resourceId: mongo.mariadbId,
				resourceName: mongo.appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
				userEmail: ctx.user.email,
			});
			const backups = await findBackupsByDbId(input.mariadbId, "mariadb");
			const cleanupOperations = [
				async () => await removeService(mongo?.appName, mongo.serverId),
				async () => await cancelJobs(backups),
				async () => await removeMariadbById(input.mariadbId),
			];

			for (const operation of cleanupOperations) {
				try {
					await operation();
				} catch (_) {}
			}

			return mongo;
		}

		case MariadbMethod.saveEnvironment: {
			const input = decodeArgs<{ mariadbId: string; env?: string }>(
				call.payload,
			);
			await checkServicePermissionAndAccess(ctx, input.mariadbId, {
				envVars: ["write"],
			});
			const service = await updateMariadbById(input.mariadbId, {
				env: input.env,
			});

			if (!service) {
				throw new BadRequestError("Error adding environment variables");
			}

			console.info("[audit] mariadb.update", {
				action: "update",
				resourceType: "service",
				resourceId: input.mariadbId,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
				userEmail: ctx.user.email,
			});
			return true;
		}

		case MariadbMethod.reload: {
			const input = decodeArgs<{ mariadbId: string }>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mariadbId, {
				deployment: ["create"],
			});
			const mariadb = await findMariadbById(input.mariadbId);
			if (mariadb.serverId) {
				await stopServiceRemote(mariadb.serverId, mariadb.appName);
			} else {
				await stopService(mariadb.appName);
			}
			await updateMariadbById(input.mariadbId, {
				applicationStatus: "idle",
			});

			if (mariadb.serverId) {
				await startServiceRemote(mariadb.serverId, mariadb.appName);
			} else {
				await startService(mariadb.appName);
			}
			await updateMariadbById(input.mariadbId, {
				applicationStatus: "done",
			});
			console.info("[audit] mariadb.reload", {
				action: "reload",
				resourceType: "service",
				resourceId: mariadb.mariadbId,
				resourceName: mariadb.appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
				userEmail: ctx.user.email,
			});
			return true;
		}

		case MariadbMethod.update: {
			const input = decodeArgs<{
				mariadbId: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiUpdateMariaDB input, ported verbatim
				[k: string]: any;
			}>(call.payload);
			const { mariadbId, ...rest } = input;
			await checkServicePermissionAndAccess(ctx, mariadbId, {
				service: ["create"],
			});
			const service = await updateMariadbById(mariadbId, {
				...rest,
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
			} as any);

			if (!service) {
				throw new BadRequestError("Update: Error updating Mariadb");
			}

			console.info("[audit] mariadb.update", {
				action: "update",
				resourceType: "service",
				resourceId: mariadbId,
				resourceName: service.appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
				userEmail: ctx.user.email,
			});
			return true;
		}

		case MariadbMethod.changePassword: {
			const input = decodeArgs<{
				mariadbId: string;
				password: string;
				type: "user" | "root";
			}>(call.payload);
			const { mariadbId, password, type } = input;
			await checkServicePermissionAndAccess(ctx, mariadbId, {
				service: ["create"],
			});

			const maria = await findMariadbById(mariadbId);
			const { appName, serverId, databaseUser, databaseRootPassword } = maria;

			const containerCmd = getServiceContainerCommand(appName);
			const targetUser = type === "root" ? "root" : databaseUser;

			const command = `
				CONTAINER_ID=$(${containerCmd})
				if [ -z "$CONTAINER_ID" ]; then
					echo "No running container found for ${appName}" >&2
					exit 1
				fi
				docker exec "$CONTAINER_ID" mariadb -u root -p'${databaseRootPassword}' -e "ALTER USER '${targetUser}'@'%' IDENTIFIED BY '${password}'; FLUSH PRIVILEGES;"
			`;

			await db.transaction(async (tx) => {
				const setData =
					type === "root"
						? { databaseRootPassword: password }
						: { databasePassword: password };
				await tx
					.update(mariadbTable)
					.set(setData)
					.where(eq(mariadbTable.mariadbId, mariadbId));

				if (serverId) {
					await execAsyncRemote(serverId, command);
				} else {
					await execAsync(command, { shell: "/bin/bash" });
				}
			});

			console.info("[audit] mariadb.update", {
				action: "update",
				resourceType: "service",
				resourceId: mariadbId,
				resourceName: appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
				userEmail: ctx.user.email,
			});

			return true;
		}

		case MariadbMethod.move: {
			const input = decodeArgs<{
				mariadbId: string;
				targetEnvironmentId: string;
			}>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mariadbId, {
				service: ["create"],
			});

			const updatedMariadb = await db
				.update(mariadbTable)
				.set({
					environmentId: input.targetEnvironmentId,
				})
				.where(eq(mariadbTable.mariadbId, input.mariadbId))
				.returning()
				.then((res) => res[0]);

			if (!updatedMariadb) {
				throw new Error("Failed to move mariadb");
			}

			console.info("[audit] mariadb.move", {
				action: "move",
				resourceType: "service",
				resourceId: updatedMariadb.mariadbId,
				resourceName: updatedMariadb.appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
				userEmail: ctx.user.email,
			});
			return updatedMariadb;
		}

		case MariadbMethod.rebuild: {
			const input = decodeArgs<{ mariadbId: string }>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mariadbId, {
				deployment: ["create"],
			});

			await rebuildDatabase(input.mariadbId, "mariadb");
			console.info("[audit] mariadb.rebuild", {
				action: "rebuild",
				resourceType: "service",
				resourceId: input.mariadbId,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
				userEmail: ctx.user.email,
			});
			return true;
		}

		case MariadbMethod.search: {
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
				eq(projects.organizationId, ctx.session.activeOrganizationId),
			];
			if (input.projectId) {
				baseConditions.push(eq(environments.projectId, input.projectId));
			}
			if (input.environmentId) {
				baseConditions.push(
					eq(mariadbTable.environmentId, input.environmentId),
				);
			}
			if (input.q?.trim()) {
				const term = `%${input.q.trim()}%`;
				baseConditions.push(
					or(
						ilike(mariadbTable.name, term),
						ilike(mariadbTable.appName, term),
						ilike(mariadbTable.description ?? "", term),
					)!,
				);
			}
			if (input.name?.trim()) {
				baseConditions.push(ilike(mariadbTable.name, `%${input.name.trim()}%`));
			}
			if (input.appName?.trim()) {
				baseConditions.push(
					ilike(mariadbTable.appName, `%${input.appName.trim()}%`),
				);
			}
			if (input.description?.trim()) {
				baseConditions.push(
					ilike(
						mariadbTable.description ?? "",
						`%${input.description.trim()}%`,
					),
				);
			}
			const { accessedServices } = await findMemberById(
				ctx.user.id,
				ctx.session.activeOrganizationId,
			);
			if (accessedServices.length === 0) return { items: [], total: 0 };
			baseConditions.push(
				sql`${mariadbTable.mariadbId} IN (${sql.join(
					accessedServices.map((id: string) => sql`${id}`),
					sql`, `,
				)})`,
			);

			const where = and(...baseConditions);
			const [items, countResult] = await Promise.all([
				db
					.select({
						mariadbId: mariadbTable.mariadbId,
						name: mariadbTable.name,
						appName: mariadbTable.appName,
						description: mariadbTable.description,
						environmentId: mariadbTable.environmentId,
						applicationStatus: mariadbTable.applicationStatus,
						createdAt: mariadbTable.createdAt,
					})
					.from(mariadbTable)
					.innerJoin(
						environments,
						eq(mariadbTable.environmentId, environments.environmentId),
					)
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(where)
					.orderBy(desc(mariadbTable.createdAt))
					.limit(input.limit)
					.offset(input.offset),
				db
					.select({ count: sql<number>`count(*)::int` })
					.from(mariadbTable)
					.innerJoin(
						environments,
						eq(mariadbTable.environmentId, environments.environmentId),
					)
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(where),
			]);
			return { items, total: countResult[0]?.count ?? 0 };
		}

		case MariadbMethod.readLogs: {
			const input = decodeArgs<{
				mariadbId: string;
				tail: number;
				since: string;
				search?: string;
			}>(call.payload);
			await checkServiceAccess(
				ctx.user.id,
				input.mariadbId,
				ctx.session.activeOrganizationId,
				"access",
			);
			const mariadb = await findMariadbById(input.mariadbId);
			if (
				mariadb.environment.project.organizationId !==
				ctx.session.activeOrganizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to access this MariaDB",
				);
			}
			return await getContainerLogs(
				mariadb.appName,
				input.tail,
				input.since,
				input.search,
				mariadb.serverId,
			);
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
