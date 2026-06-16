// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// environment-cap.ts — the native @zap-proto/web Environment capability.
//
// Binary-ZAP replacement for the tRPC `environmentRouter`
// (server/api/routers/environment.ts):
//   - environmentMintCap: bearer→ctx boundary at the WS upgrade. Mirrors the
//                         tRPC procedures' gating: a session+user is required
//                         (replaces `protectedProcedure`); a null return rejects
//                         the upgrade with HTTP 401.
//   - environmentRootCap: rootCap(ctx) → CallHandler. Dispatches each decoded
//                         ZAP Call by its method ordinal (EnvironmentMethod,
//                         generated from environment.zap) to the same service
//                         functions the tRPC procedure called, with the same
//                         org-ownership, member-access and permission checks
//                         ported verbatim.
//
// Inputs ride the shared Args carrier (decodeArgs); results the shared Result
// carrier (encodeResult). The EnvironmentMethod ordinal table is generated from
// environment.zap.

import type { IncomingMessage } from "node:http";
import {
	checkEnvironmentAccess,
	checkEnvironmentCreationPermission,
	checkEnvironmentDeletionPermission,
	// PRE-EXISTING: `checkPermission` and `findMemberByUserId` are not exported
	// by the Hanzo fork (the fork ships `findMemberById` and has no granular
	// permission helper). The old tRPC environmentRouter references the same two
	// names and fails identically — this is a fork gap, not a cap regression.
	checkPermission,
	createEnvironment,
	deleteEnvironment,
	duplicateEnvironment,
	findEnvironmentById,
	findEnvironmentsByProjectId,
	findMemberByUserId,
	updateEnvironmentById,
	addNewEnvironment,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { environments, projects } from "@hanzo/platform/db/schema";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { EnvironmentMethod } from "./schema/environment_zap";

/**
 * Per-connection auth context — the nested tRPC ctx shape the ported service
 * calls expect (`ctx.session.activeOrganizationId`, `ctx.user.{id,role}`, and
 * `ctx` itself for checkEnvironment* / checkPermission / addNewEnvironment).
 */
export interface EnvironmentCtx {
	session: { activeOrganizationId: string };
	user: { id: string; role: "owner" | "member" | "admin" };
}

/** Typed errors → ZAP status codes (mirror the tRPC error codes). */
class BadRequestError extends Error {}
class ForbiddenError extends Error {}

const filterEnvironmentServices = (
	environment: any,
	accessedServices: string[],
) => ({
	...environment,
	applications: environment.applications.filter((app: any) =>
		accessedServices.includes(app.applicationId),
	),
	compose: environment.compose.filter((comp: any) =>
		accessedServices.includes(comp.composeId),
	),
	libsql: environment.libsql.filter((db: any) =>
		accessedServices.includes(db.libsqlId),
	),
	mariadb: environment.mariadb.filter((db: any) =>
		accessedServices.includes(db.mariadbId),
	),
	mongo: environment.mongo.filter((db: any) =>
		accessedServices.includes(db.mongoId),
	),
	mysql: environment.mysql.filter((db: any) =>
		accessedServices.includes(db.mysqlId),
	),
	postgres: environment.postgres.filter((db: any) =>
		accessedServices.includes(db.postgresId),
	),
	redis: environment.redis.filter((db: any) =>
		accessedServices.includes(db.redisId),
	),
});

/**
 * environmentMintCap — bearer→ctx boundary. Requires a session+user (mirrors
 * `protectedProcedure`); null → HTTP 401 before any socket opens.
 */
export const environmentMintCap: MintCap<EnvironmentCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const activeOrganizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const role = ((user as { role?: string }).role ??
		"member") as EnvironmentCtx["user"]["role"];
	return {
		session: { activeOrganizationId },
		user: { id: (user as { id: string }).id, role },
	};
};

/**
 * environmentRootCap — the connection's dispatch root. For each decoded Call,
 * decode the input via the shared Args carrier, run the matching service
 * function (the very same one the tRPC procedure ran), and encode the result.
 * Errors map to ZAP status codes, never a thrown HTTP 500 leak.
 */
export function environmentRootCap(ctx: EnvironmentCtx): CallHandler {
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
				err instanceof ForbiddenError
					? Status.Forbidden
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

async function dispatch(ctx: EnvironmentCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case EnvironmentMethod.create: {
			const input = decodeArgs<{ projectId: string; name: string }>(
				call.payload,
			);
			try {
				await checkEnvironmentCreationPermission(
					ctx.user.id,
					input.projectId,
					ctx.session.activeOrganizationId,
				);

				if (input.name === "production") {
					throw new BadRequestError(
						"You cannot create a environment with the name 'production'",
					);
				}

				const environment = await createEnvironment(input);

				await addNewEnvironment(
					ctx.user.id,
					environment.environmentId,
					ctx.session.activeOrganizationId,
				);
				console.info("[audit] environment.create", {
					action: "create",
					resourceType: "environment",
					resourceId: environment.environmentId,
					resourceName: environment.name,
				});
				return environment;
			} catch (error) {
				if (error instanceof BadRequestError) {
					throw error;
				}
				throw new BadRequestError(
					`Error creating the environment: ${error instanceof Error ? error.message : error}`,
				);
			}
		}

		case EnvironmentMethod.one: {
			const input = decodeArgs<{ environmentId: string }>(call.payload);
			const environment = await findEnvironmentById(input.environmentId);
			if (
				environment.project.organizationId !== ctx.session.activeOrganizationId
			) {
				throw new ForbiddenError(
					"You are not allowed to access this environment",
				);
			}

			if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
				const { accessedEnvironments, accessedServices } =
					await findMemberByUserId(
						ctx.user.id,
						ctx.session.activeOrganizationId,
					);

				if (!accessedEnvironments.includes(environment.environmentId)) {
					throw new ForbiddenError(
						"You are not allowed to access this environment",
					);
				}

				const filteredEnvironment = filterEnvironmentServices(
					environment,
					accessedServices,
				);

				return filteredEnvironment;
			}

			return environment;
		}

		case EnvironmentMethod.byProjectId: {
			const input = decodeArgs<{ projectId: string }>(call.payload);
			try {
				const environments = await findEnvironmentsByProjectId(
					input.projectId,
				);

				if (
					environments.some(
						(environment) =>
							environment.project.organizationId !==
							ctx.session.activeOrganizationId,
					)
				) {
					throw new ForbiddenError(
						"You are not allowed to access this environment",
					);
				}

				if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
					const { accessedEnvironments, accessedServices } =
						await findMemberByUserId(
							ctx.user.id,
							ctx.session.activeOrganizationId,
						);

					const filteredEnvironments = environments
						.filter((environment) =>
							accessedEnvironments.includes(environment.environmentId),
						)
						.map((environment) =>
							filterEnvironmentServices(environment, accessedServices),
						);

					return filteredEnvironments;
				}

				return environments;
			} catch (error) {
				throw new BadRequestError(
					`Error fetching environments: ${error instanceof Error ? error.message : error}`,
				);
			}
		}

		case EnvironmentMethod.remove: {
			const input = decodeArgs<{ environmentId: string }>(call.payload);
			try {
				const environment = await findEnvironmentById(input.environmentId);
				if (
					environment.project.organizationId !==
					ctx.session.activeOrganizationId
				) {
					throw new ForbiddenError(
						"You are not allowed to access this environment",
					);
				}

				if (environment.isDefault) {
					throw new BadRequestError(
						"You cannot delete the default environment",
					);
				}

				await checkEnvironmentDeletionPermission(
					ctx.user.id,
					environment.projectId,
					ctx.session.activeOrganizationId,
				);

				await checkEnvironmentAccess(
					ctx.user.id,
					input.environmentId,
					ctx.session.activeOrganizationId,
					"access",
				);

				const deletedEnvironment = await deleteEnvironment(
					input.environmentId,
				);
				console.info("[audit] environment.delete", {
					action: "delete",
					resourceType: "environment",
					resourceId: deletedEnvironment?.environmentId,
					resourceName: deletedEnvironment?.name,
				});
				return deletedEnvironment;
			} catch (error) {
				if (
					error instanceof ForbiddenError ||
					error instanceof BadRequestError
				) {
					throw error;
				}
				throw new BadRequestError(
					`Error deleting the environment: ${error instanceof Error ? error.message : error}`,
				);
			}
		}

		case EnvironmentMethod.update: {
			const input = decodeArgs<{
				environmentId: string;
				env?: string;
				name?: string;
				[k: string]: unknown;
			}>(call.payload);
			try {
				const { environmentId, ...updateData } = input;

				await checkEnvironmentAccess(
					ctx.user.id,
					environmentId,
					ctx.session.activeOrganizationId,
					"access",
				);

				if (updateData.env !== undefined) {
					await checkPermission(ctx, { environmentEnvVars: ["write"] });
				}

				const currentEnvironment = await findEnvironmentById(environmentId);

				if (currentEnvironment.isDefault && updateData.name !== undefined) {
					throw new BadRequestError(
						"You cannot rename the default environment",
					);
				}
				if (
					currentEnvironment.project.organizationId !==
					ctx.session.activeOrganizationId
				) {
					throw new ForbiddenError(
						"You are not allowed to access this environment",
					);
				}

				if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
					const { accessedEnvironments } = await findMemberByUserId(
						ctx.user.id,
						ctx.session.activeOrganizationId,
					);

					if (
						!accessedEnvironments.includes(currentEnvironment.environmentId)
					) {
						throw new ForbiddenError(
							"You are not allowed to update this environment",
						);
					}
				}

				const environment = await updateEnvironmentById(
					environmentId,
					updateData,
				);
				if (environment) {
					console.info("[audit] environment.update", {
						action: "update",
						resourceType: "environment",
						resourceId: environment.environmentId,
						resourceName: environment.name,
					});
				}
				return environment;
			} catch (error) {
				throw new BadRequestError(
					`Error updating the environment: ${error instanceof Error ? error.message : error}`,
				);
			}
		}

		case EnvironmentMethod.duplicate: {
			const input = decodeArgs<{
				environmentId: string;
				name: string;
				description?: string;
			}>(call.payload);
			try {
				await checkEnvironmentAccess(
					ctx.user.id,
					input.environmentId,
					ctx.session.activeOrganizationId,
					"access",
				);
				const environment = await findEnvironmentById(input.environmentId);
				if (
					environment.project.organizationId !==
					ctx.session.activeOrganizationId
				) {
					throw new ForbiddenError(
						"You are not allowed to access this environment",
					);
				}

				if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
					const { accessedEnvironments } = await findMemberByUserId(
						ctx.user.id,
						ctx.session.activeOrganizationId,
					);

					if (!accessedEnvironments.includes(environment.environmentId)) {
						throw new ForbiddenError(
							"You are not allowed to duplicate this environment",
						);
					}
				}

				const duplicatedEnvironment = await duplicateEnvironment({
					environmentId: input.environmentId,
					name: input.name,
					...(input.description !== undefined
						? { description: input.description }
						: {}),
				});
				console.info("[audit] environment.create", {
					action: "create",
					resourceType: "environment",
					resourceId: duplicatedEnvironment.environmentId,
					resourceName: duplicatedEnvironment.name,
					metadata: { duplicatedFrom: input.environmentId },
				});
				return duplicatedEnvironment;
			} catch (error) {
				throw new BadRequestError(
					`Error duplicating the environment: ${error instanceof Error ? error.message : error}`,
				);
			}
		}

		case EnvironmentMethod.search: {
			const input = decodeArgs<{
				q?: string;
				name?: string;
				description?: string;
				projectId?: string;
				limit: number;
				offset: number;
			}>(call.payload);
			const baseConditions = [
				eq(projects.organizationId, ctx.session.activeOrganizationId),
			];

			if (input.projectId) {
				baseConditions.push(eq(environments.projectId, input.projectId));
			}

			if (input.q?.trim()) {
				const term = `%${input.q.trim()}%`;
				baseConditions.push(
					or(
						ilike(environments.name, term),
						ilike(environments.description ?? "", term),
					)!,
				);
			}

			if (input.name?.trim()) {
				baseConditions.push(ilike(environments.name, `%${input.name.trim()}%`));
			}
			if (input.description?.trim()) {
				baseConditions.push(
					ilike(
						environments.description ?? "",
						`%${input.description.trim()}%`,
					),
				);
			}

			if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
				const { accessedEnvironments } = await findMemberByUserId(
					ctx.user.id,
					ctx.session.activeOrganizationId,
				);
				if (accessedEnvironments.length === 0) return { items: [], total: 0 };
				baseConditions.push(
					sql`${environments.environmentId} IN (${sql.join(
						accessedEnvironments.map((id: string) => sql`${id}`),
						sql`, `,
					)})`,
				);
			}

			const where = and(...baseConditions);

			const [items, countResult] = await Promise.all([
				db
					.select({
						environmentId: environments.environmentId,
						name: environments.name,
						description: environments.description,
						createdAt: environments.createdAt,
						env: environments.env,
						projectId: environments.projectId,
						isDefault: environments.isDefault,
					})
					.from(environments)
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(where)
					.orderBy(desc(environments.createdAt))
					.limit(input.limit)
					.offset(input.offset),
				db
					.select({ count: sql<number>`count(*)::int` })
					.from(environments)
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(where),
			]);

			return {
				items,
				total: countResult[0]?.count ?? 0,
			};
		}

		default:
			throw new BadRequestError(`unknown method ${call.method}`);
	}
}
