// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// mongo-cap.ts — the native @zap-proto/web Mongo capability.
//
// Binary-ZAP replacement for the tRPC `mongoRouter`
// (server/api/routers/mongo.ts). Every method was `protectedProcedure`
// (authenticated caller, session+user) whose body additionally enforces
// per-service access (checkServiceAccess / checkServicePermissionAndAccess) and
// per-mongo org ownership. `deployWithLogs` was a tRPC `.subscription()`
// yielding deploy log lines — it is ported verbatim with the yielded log lines
// collected into an array returned via the shared Result carrier (ZAP requests
// are request/response, not streams). The mint boundary requires session+user
// (a null return rejects the WS upgrade with HTTP 401, mirroring
// protectedProcedure); the per-mongo access/ownership checks run INSIDE
// dispatch, verbatim from the original procedure bodies. Inputs ride the shared
// Args carrier, results the shared Result carrier; MongoMethod ordinals are
// generated from mongo.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// mongo.<action>", …)`, mirroring how registry-cap.ts / backup-cap.ts ported
// their audit.

import type { IncomingMessage } from "node:http";
import {
	checkPortInUse,
	createMongo,
	createMount,
	deployMongo,
	execAsync,
	execAsyncRemote,
	findBackupsByDbId,
	findEnvironmentById,
	findMongoById,
	findProjectById,
	// PRE-EXISTING: getAccessibleServerIds dropped by the Hanzo fork (the tRPC mongoRouter references it too)
	getAccessibleServerIds,
	// PRE-EXISTING: getContainerLogs dropped by the Hanzo fork (the tRPC mongoRouter references it too)
	getContainerLogs,
	getServiceContainerCommand,
	getWebServerSettings,
	IS_CLOUD,
	rebuildDatabase,
	removeMongoById,
	removeService,
	startService,
	startServiceRemote,
	stopService,
	stopServiceRemote,
	updateMongoById,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { validateRequest } from "@hanzo/platform/lib/auth";
// PRE-EXISTING: module @hanzo/platform/services/permission dropped by the Hanzo fork (the tRPC mongoRouter references it too)
import {
	checkServicePermissionAndAccess,
	findMemberById,
} from "@hanzo/platform/services/permission";
import {
	addNewService,
	checkServiceAccess,
} from "@hanzo/platform/services/user";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
	// PRE-EXISTING: DATABASE_PASSWORD_MESSAGE dropped by the Hanzo fork (the tRPC mongoRouter references it too)
	DATABASE_PASSWORD_MESSAGE,
	// PRE-EXISTING: DATABASE_PASSWORD_REGEX dropped by the Hanzo fork (the tRPC mongoRouter references it too)
	DATABASE_PASSWORD_REGEX,
	environments,
	mongo as mongoTable,
	projects,
} from "@/server/db/schema";
import { cancelJobs } from "@/server/utils/backup";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { MongoMethod } from "./schema/mongo_zap";

/**
 * Per-connection auth context — the tRPC ctx shape the ported service calls
 * expect (`ctx.session.activeOrganizationId`, `ctx.user.id`, and `ctx` itself
 * for checkServiceAccess / addNewService / checkServicePermissionAndAccess).
 */
export interface MongoCtx {
	session: { activeOrganizationId: string };
	user: { id: string; role: "owner" | "member" | "admin" };
}

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}
/** Typed conflict failure → ZAP Status.BadRequest. */
class ConflictError extends Error {}
/** Typed internal failure → ZAP Status.Internal. */
class InternalError extends Error {}

/**
 * mongoMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication half: validates the upgrade and requires session+user. Null →
 * HTTP 401 before any socket opens. The per-mongo access/ownership half runs
 * inside dispatch (verbatim from the bodies).
 */
export const mongoMintCap: MintCap<MongoCtx> = async (req: IncomingMessage) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const activeOrganizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const role = ((user as { role?: string }).role ??
		"member") as MongoCtx["user"]["role"];
	return {
		session: { activeOrganizationId },
		user: { id: (user as { id: string }).id, role },
	};
};

/**
 * mongoRootCap — dispatch each decoded Call by MongoMethod ordinal to the same
 * service functions the tRPC procedure called. Inputs decode via the shared Args
 * carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function mongoRootCap(ctx: MongoCtx): CallHandler {
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

async function dispatch(ctx: MongoCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case MongoMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: apiCreateMongo input, ported verbatim
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
					// PRE-EXISTING: remoteServersOnly dropped by the Hanzo fork (the tRPC mongoRouter references it too)
					(IS_CLOUD || webServerSettings?.remoteServersOnly) &&
					!input.serverId
				) {
					throw new UnauthorizedError(
						"You need to use a server to create a mongo",
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

				const newMongo = await createMongo({
					...input,
				});
				await addNewService(
					ctx.user.id,
					newMongo.mongoId,
					ctx.session.activeOrganizationId,
				);

				await createMount({
					serviceId: newMongo.mongoId,
					serviceType: "mongo",
					volumeName: `${newMongo.appName}-data`,
					mountPath: "/data/db",
					type: "volume",
				});

				console.info("[audit] mongo.create", {
					action: "create",
					resourceType: "service",
					resourceId: newMongo.mongoId,
					resourceName: newMongo.appName,
					organizationId: ctx.session.activeOrganizationId,
					userId: ctx.user.id,
				});
				return newMongo;
			} catch (error) {
				if (error instanceof UnauthorizedError) {
					throw error;
				}
				throw new BadRequestError("Error input: Inserting mongo database");
			}
		}

		case MongoMethod.one: {
			const input = decodeArgs<{ mongoId: string }>(call.payload);
			await checkServiceAccess(
				ctx.user.id,
				input.mongoId,
				ctx.session.activeOrganizationId,
				"access",
			);

			const mongo = await findMongoById(input.mongoId);
			if (
				mongo.environment.project.organizationId !==
				ctx.session.activeOrganizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to access this mongo",
				);
			}
			return mongo;
		}

		case MongoMethod.start: {
			const input = decodeArgs<{ mongoId: string }>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mongoId, {
				deployment: ["create"],
			});
			const service = await findMongoById(input.mongoId);

			if (service.serverId) {
				await startServiceRemote(service.serverId, service.appName);
			} else {
				await startService(service.appName);
			}
			await updateMongoById(input.mongoId, {
				applicationStatus: "done",
			});

			console.info("[audit] mongo.start", {
				action: "start",
				resourceType: "service",
				resourceId: service.mongoId,
				resourceName: service.appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
			});
			return service;
		}

		case MongoMethod.stop: {
			const input = decodeArgs<{ mongoId: string }>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mongoId, {
				deployment: ["create"],
			});
			const mongo = await findMongoById(input.mongoId);

			if (mongo.serverId) {
				await stopServiceRemote(mongo.serverId, mongo.appName);
			} else {
				await stopService(mongo.appName);
			}
			await updateMongoById(input.mongoId, {
				applicationStatus: "idle",
			});

			console.info("[audit] mongo.stop", {
				action: "stop",
				resourceType: "service",
				resourceId: mongo.mongoId,
				resourceName: mongo.appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
			});
			return mongo;
		}

		case MongoMethod.saveExternalPort: {
			// biome-ignore lint/suspicious/noExplicitAny: apiSaveExternalPortMongo input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mongoId, {
				service: ["create"],
			});
			const mongo = await findMongoById(input.mongoId);

			if (input.externalPort) {
				const portCheck = await checkPortInUse(
					input.externalPort,
					mongo.serverId || undefined,
				);
				if (portCheck.isInUse) {
					throw new ConflictError(
						`Port ${input.externalPort} is already in use by ${portCheck.conflictingContainer}`,
					);
				}
			}

			await updateMongoById(input.mongoId, {
				externalPort: input.externalPort,
			});
			await deployMongo(input.mongoId);
			console.info("[audit] mongo.update", {
				action: "update",
				resourceType: "service",
				resourceId: mongo.mongoId,
				resourceName: mongo.appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
			});
			return mongo;
		}

		case MongoMethod.deploy: {
			// biome-ignore lint/suspicious/noExplicitAny: apiDeployMongo input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mongoId, {
				deployment: ["create"],
			});
			const mongo = await findMongoById(input.mongoId);
			console.info("[audit] mongo.deploy", {
				action: "deploy",
				resourceType: "service",
				resourceId: mongo.mongoId,
				resourceName: mongo.appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
			});
			return deployMongo(input.mongoId);
		}

		case MongoMethod.deployWithLogs: {
			// Ported verbatim from the tRPC `.subscription()`: the original was an
			// async generator yielding deploy log lines to the client. ZAP requests
			// are request/response, so the yielded log lines are collected into an
			// array and returned via the shared Result carrier rather than streamed.
			// biome-ignore lint/suspicious/noExplicitAny: apiDeployMongo input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mongoId, {
				deployment: ["create"],
			});
			const queue: string[] = [];
			let done = false;

			deployMongo(input.mongoId, (log) => {
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

		case MongoMethod.changeStatus: {
			// biome-ignore lint/suspicious/noExplicitAny: apiChangeMongoStatus input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mongoId, {
				deployment: ["create"],
			});
			const mongo = await findMongoById(input.mongoId);
			await updateMongoById(input.mongoId, {
				applicationStatus: input.applicationStatus,
			});
			console.info("[audit] mongo.update", {
				action: "update",
				resourceType: "service",
				resourceId: mongo.mongoId,
				resourceName: mongo.appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
			});
			return mongo;
		}

		case MongoMethod.reload: {
			// biome-ignore lint/suspicious/noExplicitAny: apiResetMongo input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mongoId, {
				deployment: ["create"],
			});
			const mongo = await findMongoById(input.mongoId);
			if (mongo.serverId) {
				await stopServiceRemote(mongo.serverId, mongo.appName);
			} else {
				await stopService(mongo.appName);
			}
			await updateMongoById(input.mongoId, {
				applicationStatus: "idle",
			});

			if (mongo.serverId) {
				await startServiceRemote(mongo.serverId, mongo.appName);
			} else {
				await startService(mongo.appName);
			}
			await updateMongoById(input.mongoId, {
				applicationStatus: "done",
			});
			console.info("[audit] mongo.reload", {
				action: "reload",
				resourceType: "service",
				resourceId: mongo.mongoId,
				resourceName: mongo.appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
			});
			return true;
		}

		case MongoMethod.remove: {
			const input = decodeArgs<{ mongoId: string }>(call.payload);
			await checkServiceAccess(
				ctx.user.id,
				input.mongoId,
				ctx.session.activeOrganizationId,
				"delete",
			);

			const mongo = await findMongoById(input.mongoId);

			if (
				mongo.environment.project.organizationId !==
				ctx.session.activeOrganizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to delete this mongo",
				);
			}
			console.info("[audit] mongo.delete", {
				action: "delete",
				resourceType: "service",
				resourceId: mongo.mongoId,
				resourceName: mongo.appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
			});
			const backups = await findBackupsByDbId(input.mongoId, "mongo");

			const cleanupOperations = [
				async () => await removeService(mongo?.appName, mongo.serverId),
				async () => await cancelJobs(backups),
				async () => await removeMongoById(input.mongoId),
			];

			for (const operation of cleanupOperations) {
				try {
					await operation();
				} catch (_) {}
			}

			return mongo;
		}

		case MongoMethod.saveEnvironment: {
			// biome-ignore lint/suspicious/noExplicitAny: apiSaveEnvironmentVariablesMongo input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mongoId, {
				envVars: ["write"],
			});
			const service = await updateMongoById(input.mongoId, {
				env: input.env,
			});

			if (!service) {
				throw new BadRequestError("Error adding environment variables");
			}

			console.info("[audit] mongo.update", {
				action: "update",
				resourceType: "service",
				resourceId: input.mongoId,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
			});
			return true;
		}

		case MongoMethod.update: {
			// biome-ignore lint/suspicious/noExplicitAny: apiUpdateMongo input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			const { mongoId, ...rest } = input;
			await checkServicePermissionAndAccess(ctx, mongoId, {
				service: ["create"],
			});
			const service = await updateMongoById(mongoId, {
				...rest,
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
			} as any);

			if (!service) {
				throw new BadRequestError("Update: Error updating Mongo");
			}

			console.info("[audit] mongo.update", {
				action: "update",
				resourceType: "service",
				resourceId: mongoId,
				resourceName: service.appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
			});
			return true;
		}

		case MongoMethod.changePassword: {
			const input = decodeArgs<{ mongoId: string; password: string }>(
				call.payload,
			);
			const { mongoId, password } = input;
			if (!mongoId || mongoId.length < 1) {
				throw new BadRequestError("mongoId is required");
			}
			if (!password || !DATABASE_PASSWORD_REGEX.test(password)) {
				throw new BadRequestError(DATABASE_PASSWORD_MESSAGE);
			}
			await checkServicePermissionAndAccess(ctx, mongoId, {
				service: ["create"],
			});

			const mongo = await findMongoById(mongoId);
			const { appName, serverId, databaseUser, databasePassword } = mongo;

			const containerCmd = getServiceContainerCommand(appName);
			const command = `
				CONTAINER_ID=$(${containerCmd})
				if [ -z "$CONTAINER_ID" ]; then
					echo "No running container found for ${appName}" >&2
					exit 1
				fi
				docker exec "$CONTAINER_ID" mongosh -u '${databaseUser}' -p '${databasePassword}' --authenticationDatabase admin --eval "db.getSiblingDB('admin').changeUserPassword('${databaseUser}', '${password}')"
			`;

			await db.transaction(async (tx) => {
				await tx
					.update(mongoTable)
					.set({ databasePassword: password })
					.where(eq(mongoTable.mongoId, mongoId));

				if (serverId) {
					await execAsyncRemote(serverId, command);
				} else {
					await execAsync(command, { shell: "/bin/bash" });
				}
			});

			console.info("[audit] mongo.update", {
				action: "update",
				resourceType: "service",
				resourceId: mongoId,
				resourceName: appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
			});

			return true;
		}

		case MongoMethod.move: {
			const input = decodeArgs<{
				mongoId: string;
				targetEnvironmentId: string;
			}>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mongoId, {
				service: ["create"],
			});

			const updatedMongo = await db
				.update(mongoTable)
				.set({
					environmentId: input.targetEnvironmentId,
				})
				.where(eq(mongoTable.mongoId, input.mongoId))
				.returning()
				.then((res) => res[0]);

			if (!updatedMongo) {
				throw new InternalError("Failed to move mongo");
			}

			console.info("[audit] mongo.move", {
				action: "move",
				resourceType: "service",
				resourceId: updatedMongo.mongoId,
				resourceName: updatedMongo.appName,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
			});
			return updatedMongo;
		}

		case MongoMethod.rebuild: {
			// biome-ignore lint/suspicious/noExplicitAny: apiRebuildMongo input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.mongoId, {
				deployment: ["create"],
			});

			await rebuildDatabase(input.mongoId, "mongo");

			console.info("[audit] mongo.rebuild", {
				action: "rebuild",
				resourceType: "service",
				resourceId: input.mongoId,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
			});
			return true;
		}

		case MongoMethod.search: {
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
				baseConditions.push(eq(mongoTable.environmentId, input.environmentId));
			}
			if (input.q?.trim()) {
				const term = `%${input.q.trim()}%`;
				baseConditions.push(
					or(
						ilike(mongoTable.name, term),
						ilike(mongoTable.appName, term),
						ilike(mongoTable.description ?? "", term),
					)!,
				);
			}
			if (input.name?.trim()) {
				baseConditions.push(ilike(mongoTable.name, `%${input.name.trim()}%`));
			}
			if (input.appName?.trim()) {
				baseConditions.push(
					ilike(mongoTable.appName, `%${input.appName.trim()}%`),
				);
			}
			if (input.description?.trim()) {
				baseConditions.push(
					ilike(mongoTable.description ?? "", `%${input.description.trim()}%`),
				);
			}
			const { accessedServices } = await findMemberById(
				ctx.user.id,
				ctx.session.activeOrganizationId,
			);
			if (accessedServices.length === 0) return { items: [], total: 0 };
			baseConditions.push(
				sql`${mongoTable.mongoId} IN (${sql.join(
					accessedServices.map((id: string) => sql`${id}`),
					sql`, `,
				)})`,
			);

			const where = and(...baseConditions);
			const [items, countResult] = await Promise.all([
				db
					.select({
						mongoId: mongoTable.mongoId,
						name: mongoTable.name,
						appName: mongoTable.appName,
						description: mongoTable.description,
						environmentId: mongoTable.environmentId,
						applicationStatus: mongoTable.applicationStatus,
						createdAt: mongoTable.createdAt,
					})
					.from(mongoTable)
					.innerJoin(
						environments,
						eq(mongoTable.environmentId, environments.environmentId),
					)
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(where)
					.orderBy(desc(mongoTable.createdAt))
					.limit(input.limit)
					.offset(input.offset),
				db
					.select({ count: sql<number>`count(*)::int` })
					.from(mongoTable)
					.innerJoin(
						environments,
						eq(mongoTable.environmentId, environments.environmentId),
					)
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(where),
			]);
			return { items, total: countResult[0]?.count ?? 0 };
		}

		case MongoMethod.readLogs: {
			const input = decodeArgs<{
				mongoId: string;
				tail: number;
				since: string;
				search?: string;
			}>(call.payload);
			await checkServiceAccess(
				ctx.user.id,
				input.mongoId,
				ctx.session.activeOrganizationId,
				"access",
			);
			const mongo = await findMongoById(input.mongoId);
			if (
				mongo.environment.project.organizationId !==
				ctx.session.activeOrganizationId
			) {
				throw new UnauthorizedError(
					"You are not authorized to access this MongoDB",
				);
			}
			return await getContainerLogs(
				mongo.appName,
				input.tail,
				input.since,
				input.search,
				mongo.serverId,
			);
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
