// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// postgres-cap.ts — the native @zap-proto/web Postgres capability.
//
// Binary-ZAP replacement for the tRPC `postgresRouter`
// (server/api/routers/postgres.ts). Every method was a `protectedProcedure`
// (authenticated caller, session+user) whose body additionally enforces
// per-Postgres org ownership via checkServiceAccess /
// checkServicePermissionAndAccess. `deployWithLogs` was a tRPC `.subscription()`
// async generator yielding deploy log lines — it is ported verbatim with the
// yielded log lines collected into an array returned via the shared Result
// carrier. The mint boundary requires session+user (a null return rejects the
// WS upgrade with HTTP 401, mirroring protectedProcedure); the per-Postgres
// authorization checks run INSIDE dispatch, verbatim from the original procedure
// bodies. Inputs ride the shared Args carrier, results the shared Result
// carrier; PostgresMethod ordinals are generated from postgres.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// postgres.<action>", …)`, mirroring how backup-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	addNewService,
	checkPortInUse,
	checkServiceAccess,
	// PRE-EXISTING: checkServicePermissionAndAccess was dropped by the Hanzo fork
	// (the tRPC postgresRouter references it too and fails identically).
	checkServicePermissionAndAccess,
	createMount,
	createPostgres,
	deployPostgres,
	execAsync,
	execAsyncRemote,
	findBackupsByDbId,
	findEnvironmentById,
	findMemberById,
	findPostgresById,
	findProjectById,
	// PRE-EXISTING: getAccessibleServerIds / getContainerLogs were dropped by the
	// Hanzo fork (the tRPC postgresRouter imports them too and fails identically).
	getAccessibleServerIds,
	getContainerLogs,
	getMountPath,
	getServiceContainerCommand,
	getWebServerSettings,
	IS_CLOUD,
	rebuildDatabase,
	removePostgresById,
	removeService,
	startService,
	startServiceRemote,
	stopService,
	stopServiceRemote,
	updatePostgresById,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
	environments,
	postgres as postgresTable,
	projects,
} from "@/server/db/schema";
import { cancelJobs } from "@/server/utils/backup";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { PostgresMethod } from "./schema/postgres_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface PostgresCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * postgresMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication half: validates the upgrade and requires session+user. Null →
 * HTTP 401 before any socket opens. The per-Postgres org-ownership half runs
 * inside dispatch (verbatim from the bodies).
 */
export const postgresMintCap: MintCap<PostgresCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as PostgresCtx["userRole"];
	const userId = (user as { id?: string }).id || "";
	const email = (user as { email?: string }).email || "";
	return { organizationId, userRole, userId, email };
};

/**
 * permCtx — adapt the flat per-connection PostgresCtx to the `PermissionCtx`
 * shape (`{ user: { id }, session: { activeOrganizationId } }`) that
 * checkServiceAccess / checkServicePermissionAndAccess / addNewService read. The
 * tRPC procedure passed its own nested `ctx` directly; here the minted ctx is
 * flat, so we reshape at the call site. Same values, different access path.
 */
const permCtx = (ctx: PostgresCtx) => ({
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

/**
 * postgresRootCap — dispatch each decoded Call by PostgresMethod ordinal to the
 * same service functions the tRPC procedure called. Inputs decode via the shared
 * Args carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function postgresRootCap(ctx: PostgresCtx): CallHandler {
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

async function dispatch(ctx: PostgresCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case PostgresMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: apiCreatePostgres input, ported verbatim
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
				if (
					// PRE-EXISTING: remoteServersOnly dropped by the Hanzo fork (the tRPC
					// postgresRouter references it too).
					(IS_CLOUD || webServerSettings?.remoteServersOnly) &&
					!input.serverId
				) {
					throw new UnauthorizedError(
						"You need to use a server to create a Postgres",
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

				const newPostgres = await createPostgres({
					...input,
				});
				await addNewService(
					ctx.userId,
					newPostgres.postgresId,
					ctx.organizationId,
				);

				const mountPath = getMountPath(input.dockerImage);

				await createMount({
					serviceId: newPostgres.postgresId,
					serviceType: "postgres",
					volumeName: `${newPostgres.appName}-data`,
					mountPath: mountPath,
					type: "volume",
				});

				console.info("[audit] postgres.create", {
					action: "create",
					resourceType: "service",
					resourceId: newPostgres.postgresId,
					resourceName: newPostgres.appName,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return newPostgres;
			} catch (error) {
				if (error instanceof UnauthorizedError) {
					throw error;
				}
				throw new BadRequestError("Error input: Inserting Postgres database");
			}
		}

		case PostgresMethod.one: {
			const input = decodeArgs<{ postgresId: string }>(call.payload);
			await checkServiceAccess(
				ctx.userId,
				input.postgresId,
				ctx.organizationId,
				"access",
			);

			const postgres = await findPostgresById(input.postgresId);
			if (
				postgres.environment.project.organizationId !== ctx.organizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to access this Postgres",
				);
			}
			return postgres;
		}

		case PostgresMethod.start: {
			const input = decodeArgs<{ postgresId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.postgresId, {
				deployment: ["create"],
			});
			const service = await findPostgresById(input.postgresId);

			if (service.serverId) {
				await startServiceRemote(service.serverId, service.appName);
			} else {
				await startService(service.appName);
			}
			await updatePostgresById(input.postgresId, {
				applicationStatus: "done",
			});

			console.info("[audit] postgres.start", {
				action: "start",
				resourceType: "service",
				resourceId: service.postgresId,
				resourceName: service.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return service;
		}

		case PostgresMethod.stop: {
			const input = decodeArgs<{ postgresId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.postgresId, {
				deployment: ["create"],
			});
			const postgres = await findPostgresById(input.postgresId);
			if (postgres.serverId) {
				await stopServiceRemote(postgres.serverId, postgres.appName);
			} else {
				await stopService(postgres.appName);
			}
			await updatePostgresById(input.postgresId, {
				applicationStatus: "idle",
			});

			console.info("[audit] postgres.stop", {
				action: "stop",
				resourceType: "service",
				resourceId: postgres.postgresId,
				resourceName: postgres.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return postgres;
		}

		case PostgresMethod.saveExternalPort: {
			const input = decodeArgs<{
				postgresId: string;
				externalPort?: number | null;
			}>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.postgresId, {
				service: ["create"],
			});
			const postgres = await findPostgresById(input.postgresId);

			if (input.externalPort) {
				const portCheck = await checkPortInUse(
					input.externalPort,
					postgres.serverId || undefined,
				);
				if (portCheck.isInUse) {
					throw new ConflictError(
						`Port ${input.externalPort} is already in use by ${portCheck.conflictingContainer}`,
					);
				}
			}

			await updatePostgresById(input.postgresId, {
				externalPort: input.externalPort,
			});
			await deployPostgres(input.postgresId);
			console.info("[audit] postgres.update", {
				action: "update",
				resourceType: "service",
				resourceId: postgres.postgresId,
				resourceName: postgres.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return postgres;
		}

		case PostgresMethod.deploy: {
			const input = decodeArgs<{ postgresId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.postgresId, {
				deployment: ["create"],
			});
			const postgres = await findPostgresById(input.postgresId);
			console.info("[audit] postgres.deploy", {
				action: "deploy",
				resourceType: "service",
				resourceId: postgres.postgresId,
				resourceName: postgres.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return deployPostgres(input.postgresId);
		}

		case PostgresMethod.deployWithLogs: {
			// Ported verbatim from the tRPC `.subscription()` async generator: the
			// original `yield`ed deploy log lines to the client as they were
			// produced. ZAP requests are request/response, so the yielded log lines
			// are collected into an array and returned via the shared Result carrier
			// rather than streamed.
			const input = decodeArgs<{ postgresId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.postgresId, {
				deployment: ["create"],
			});

			const queue: string[] = [];
			let done = false;

			deployPostgres(input.postgresId, (log) => {
				queue.push(log);
			})
				.catch(() => {})
				.finally(() => {
					done = true;
				});

			const logs: string[] = [];
			while (!done || queue.length > 0) {
				if (queue.length > 0) {
					logs.push(queue.shift()!);
				} else {
					await new Promise((r) => setTimeout(r, 50));
				}
			}
			return logs;
		}

		case PostgresMethod.changeStatus: {
			const input = decodeArgs<{
				postgresId: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiChangePostgresStatus input, ported verbatim
				applicationStatus: any;
			}>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.postgresId, {
				deployment: ["create"],
			});
			const postgres = await findPostgresById(input.postgresId);
			await updatePostgresById(input.postgresId, {
				applicationStatus: input.applicationStatus,
			});
			console.info("[audit] postgres.update", {
				action: "update",
				resourceType: "service",
				resourceId: postgres.postgresId,
				resourceName: postgres.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return postgres;
		}

		case PostgresMethod.remove: {
			const input = decodeArgs<{ postgresId: string }>(call.payload);
			await checkServiceAccess(
				ctx.userId,
				input.postgresId,
				ctx.organizationId,
				"delete",
			);
			const postgres = await findPostgresById(input.postgresId);

			if (
				postgres.environment.project.organizationId !== ctx.organizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to delete this Postgres",
				);
			}

			console.info("[audit] postgres.delete", {
				action: "delete",
				resourceType: "service",
				resourceId: postgres.postgresId,
				resourceName: postgres.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			const backups = await findBackupsByDbId(input.postgresId, "postgres");

			const cleanupOperations = [
				async () => await removeService(postgres?.appName, postgres.serverId),
				async () => await cancelJobs(backups),
				async () => await removePostgresById(input.postgresId),
			];

			for (const operation of cleanupOperations) {
				try {
					await operation();
				} catch (_) {}
			}

			return postgres;
		}

		case PostgresMethod.saveEnvironment: {
			const input = decodeArgs<{ postgresId: string; env?: string }>(
				call.payload,
			);
			await checkServicePermissionAndAccess(permCtx(ctx), input.postgresId, {
				envVars: ["write"],
			});
			const service = await updatePostgresById(input.postgresId, {
				env: input.env,
			});

			if (!service) {
				throw new BadRequestError("Error adding environment variables");
			}

			console.info("[audit] postgres.update", {
				action: "update",
				resourceType: "service",
				resourceId: input.postgresId,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case PostgresMethod.reload: {
			const input = decodeArgs<{ postgresId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.postgresId, {
				deployment: ["create"],
			});
			const postgres = await findPostgresById(input.postgresId);
			if (postgres.serverId) {
				await stopServiceRemote(postgres.serverId, postgres.appName);
			} else {
				await stopService(postgres.appName);
			}
			await updatePostgresById(input.postgresId, {
				applicationStatus: "idle",
			});

			if (postgres.serverId) {
				await startServiceRemote(postgres.serverId, postgres.appName);
			} else {
				await startService(postgres.appName);
			}
			await updatePostgresById(input.postgresId, {
				applicationStatus: "done",
			});
			console.info("[audit] postgres.reload", {
				action: "reload",
				resourceType: "service",
				resourceId: postgres.postgresId,
				resourceName: postgres.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case PostgresMethod.update: {
			const input = decodeArgs<{
				postgresId: string;
				// biome-ignore lint/suspicious/noExplicitAny: apiUpdatePostgres input, ported verbatim
				[k: string]: any;
			}>(call.payload);
			const { postgresId, ...rest } = input;
			await checkServicePermissionAndAccess(permCtx(ctx), postgresId, {
				service: ["create"],
			});

			const service = await updatePostgresById(postgresId, {
				...rest,
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
			} as any);

			if (!service) {
				throw new BadRequestError("Error updating Postgres");
			}

			console.info("[audit] postgres.update", {
				action: "update",
				resourceType: "service",
				resourceId: postgresId,
				resourceName: service.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case PostgresMethod.changePassword: {
			const input = decodeArgs<{ postgresId: string; password: string }>(
				call.payload,
			);
			const { postgresId, password } = input;
			await checkServicePermissionAndAccess(permCtx(ctx), postgresId, {
				service: ["create"],
			});

			const pg = await findPostgresById(postgresId);
			const { appName, serverId, databaseUser } = pg;

			const containerCmd = getServiceContainerCommand(appName);
			const command = `
				CONTAINER_ID=$(${containerCmd})
				if [ -z "$CONTAINER_ID" ]; then
					echo "No running container found for ${appName}" >&2
					exit 1
				fi
				docker exec "$CONTAINER_ID" psql -U ${databaseUser} -c "ALTER USER \\"${databaseUser}\\" WITH PASSWORD '${password}';"
			`;

			await db.transaction(async (tx) => {
				await tx
					.update(postgresTable)
					.set({ databasePassword: password })
					.where(eq(postgresTable.postgresId, postgresId));

				if (serverId) {
					await execAsyncRemote(serverId, command);
				} else {
					await execAsync(command, { shell: "/bin/bash" });
				}
			});

			console.info("[audit] postgres.update", {
				action: "update",
				resourceType: "service",
				resourceId: postgresId,
				resourceName: appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});

			return true;
		}

		case PostgresMethod.move: {
			const input = decodeArgs<{
				postgresId: string;
				targetEnvironmentId: string;
			}>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.postgresId, {
				service: ["create"],
			});

			const updatedPostgres = await db
				.update(postgresTable)
				.set({
					environmentId: input.targetEnvironmentId,
				})
				.where(eq(postgresTable.postgresId, input.postgresId))
				.returning()
				.then((res) => res[0]);

			if (!updatedPostgres) {
				throw new Error("Failed to move postgres");
			}

			console.info("[audit] postgres.move", {
				action: "move",
				resourceType: "service",
				resourceId: updatedPostgres.postgresId,
				resourceName: updatedPostgres.appName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return updatedPostgres;
		}

		case PostgresMethod.rebuild: {
			const input = decodeArgs<{ postgresId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.postgresId, {
				deployment: ["create"],
			});

			await rebuildDatabase(input.postgresId, "postgres");

			console.info("[audit] postgres.rebuild", {
				action: "rebuild",
				resourceType: "service",
				resourceId: input.postgresId,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case PostgresMethod.search: {
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
					eq(postgresTable.environmentId, input.environmentId),
				);
			}
			if (input.q?.trim()) {
				const term = `%${input.q.trim()}%`;
				baseConditions.push(
					or(
						ilike(postgresTable.name, term),
						ilike(postgresTable.appName, term),
						ilike(postgresTable.description ?? "", term),
					)!,
				);
			}
			if (input.name?.trim()) {
				baseConditions.push(
					ilike(postgresTable.name, `%${input.name.trim()}%`),
				);
			}
			if (input.appName?.trim()) {
				baseConditions.push(
					ilike(postgresTable.appName, `%${input.appName.trim()}%`),
				);
			}
			if (input.description?.trim()) {
				baseConditions.push(
					ilike(
						postgresTable.description ?? "",
						`%${input.description.trim()}%`,
					),
				);
			}
			const { accessedServices } = await findMemberById(
				ctx.userId,
				ctx.organizationId,
			);
			if (accessedServices.length === 0) return { items: [], total: 0 };
			baseConditions.push(
				sql`${postgresTable.postgresId} IN (${sql.join(
					accessedServices.map((id: string) => sql`${id}`),
					sql`, `,
				)})`,
			);

			const where = and(...baseConditions);
			const [items, countResult] = await Promise.all([
				db
					.select({
						postgresId: postgresTable.postgresId,
						name: postgresTable.name,
						appName: postgresTable.appName,
						description: postgresTable.description,
						environmentId: postgresTable.environmentId,
						applicationStatus: postgresTable.applicationStatus,
						createdAt: postgresTable.createdAt,
					})
					.from(postgresTable)
					.innerJoin(
						environments,
						eq(postgresTable.environmentId, environments.environmentId),
					)
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(where)
					.orderBy(desc(postgresTable.createdAt))
					.limit(input.limit)
					.offset(input.offset),
				db
					.select({ count: sql<number>`count(*)::int` })
					.from(postgresTable)
					.innerJoin(
						environments,
						eq(postgresTable.environmentId, environments.environmentId),
					)
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(where),
			]);
			return { items, total: countResult[0]?.count ?? 0 };
		}

		case PostgresMethod.readLogs: {
			const input = decodeArgs<{
				postgresId: string;
				tail: number;
				since: string;
				search?: string;
			}>(call.payload);
			await checkServiceAccess(
				ctx.userId,
				input.postgresId,
				ctx.organizationId,
				"access",
			);
			const postgres = await findPostgresById(input.postgresId);
			if (
				postgres.environment.project.organizationId !== ctx.organizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to access this Postgres",
				);
			}
			return await getContainerLogs(
				postgres.appName,
				input.tail,
				input.since,
				input.search,
				postgres.serverId,
			);
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
