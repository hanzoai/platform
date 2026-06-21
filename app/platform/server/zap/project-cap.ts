// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// project-cap.ts — the native @zap-proto/web Project capability.
//
// Binary-ZAP replacement for the tRPC `projectRouter`
// (server/api/routers/project.ts):
//   - projectMintCap: bearer→ctx boundary at the WS upgrade. Mirrors the tRPC
//                     procedures' gating: a session+user is required (replaces
//                     `protectedProcedure`); a null return rejects the upgrade
//                     with HTTP 401. The `allForPermissions` method was a
//                     `withPermission("member","update")` procedure — that gate
//                     is an authenticated caller plus a per-call permission
//                     check, so authentication is enforced at mint and the
//                     permission check runs verbatim in dispatch.
//   - projectRootCap: rootCap(ctx) → CallHandler. Dispatches each decoded ZAP
//                     Call by its method ordinal (ProjectMethod, generated from
//                     project.zap) to the same service functions the tRPC
//                     procedure called, with the same arguments and the same
//                     org-ownership / member-access checks ported verbatim.
//
// Inputs ride the shared Args carrier (decodeArgs); results the shared Result
// carrier (encodeResult). The ProjectMethod ordinal table is generated from
// project.zap.

import type { IncomingMessage } from "node:http";
import {
	createApplication,
	createBackup,
	createCompose,
	createDomain,
	// PRE-EXISTING: the Hanzo fork dropped the libsql service — `createLibsql`,
	// `findLibsqlById` and the `libsql` schema table do not exist in the fork.
	// The old tRPC projectRouter imports the same three names and fails
	// identically (TS2305/TS2724/TS2353). This is a fork gap, not a cap
	// regression; the `case "libsql"` duplicate arm and the `libsql:` relation
	// selections below inherit the same gap.
	createLibsql,
	createMariadb,
	createMongo,
	createMount,
	createMysql,
	createPort,
	createPostgres,
	createPreviewDeployment,
	createProject,
	createRedirect,
	createRedis,
	createSecurity,
	deleteProject,
	findApplicationById,
	findComposeById,
	findEnvironmentById,
	findLibsqlById,
	findMariadbById,
	findMongoById,
	findMySqlById,
	findPostgresById,
	findProjectById,
	findRedisById,
	findUserById,
	IS_CLOUD,
	updateProjectById,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import {
	addNewEnvironment,
	addNewProject,
	checkProjectAccess,
} from "@hanzo/platform";
import {
	checkPermission,
	findMemberByUserId,
} from "@hanzo/platform/services/permission";
import { validateRequest } from "@hanzo/platform/lib/auth";
import {
	applications,
	compose,
	environments,
	libsql,
	mariadb,
	mongo,
	mysql,
	postgres,
	projects,
	redis,
} from "@hanzo/platform/db/schema";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { ProjectMethod } from "./schema/project_zap";

/**
 * Per-connection auth context — the nested tRPC ctx shape the ported service
 * calls expect (`ctx.session.activeOrganizationId`, `ctx.user.{id,role,ownerId}`,
 * and `ctx` itself for checkProjectAccess / addNewProject / checkPermission).
 */
export interface ProjectCtx {
	session: { activeOrganizationId: string };
	user: {
		id: string;
		role: "owner" | "member" | "admin";
		ownerId: string;
		email: string;
	};
}

/** Typed errors → ZAP status codes (mirror the tRPC error codes). */
class BadRequestError extends Error {}
class ForbiddenError extends Error {}
class UnauthorizedError extends Error {}
class NotFoundError extends Error {}

/** Permission gate — mirrors `withPermission("member","update")`. */
function requireAdmin(ctx: ProjectCtx): void {
	if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
		throw new UnauthorizedError("permission denied");
	}
}

/**
 * projectMintCap — bearer→ctx boundary. Requires a session+user (mirrors
 * `protectedProcedure`); null → HTTP 401 before any socket opens.
 */
export const projectMintCap: MintCap<ProjectCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const activeOrganizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const role = ((user as { role?: string }).role ??
		"member") as ProjectCtx["user"]["role"];
	return {
		session: { activeOrganizationId },
		user: {
			id: (user as { id: string }).id,
			role,
			ownerId: (user as { ownerId?: string }).ownerId || "",
			email: (user as { email?: string }).email || "",
		},
	};
};

/**
 * projectRootCap — the connection's dispatch root. For each decoded Call, decode
 * the input via the shared Args carrier, run the matching service function (the
 * very same one the tRPC procedure ran), and encode the result. Errors map to
 * ZAP status codes, never a thrown HTTP 500 leak.
 */
export function projectRootCap(ctx: ProjectCtx): CallHandler {
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
				err instanceof NotFoundError
					? Status.NotFound
					: err instanceof ForbiddenError
						? Status.Forbidden
						: err instanceof UnauthorizedError
							? Status.Unauthorized
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

function buildServiceFilter(
	fieldName: AnySQLiteColumn,
	accessedServices: string[],
) {
	return accessedServices.length === 0
		? sql`false`
		: sql`${fieldName} IN (${sql.join(
				accessedServices.map((serviceId) => sql`${serviceId}`),
				sql`, `,
			)})`;
}

async function dispatch(ctx: ProjectCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case ProjectMethod.create: {
			const input = decodeArgs<{
				name: string;
				description?: string;
				env?: string;
			}>(call.payload);
			try {
				await checkProjectAccess(
					ctx.user.id,
					"create",
					ctx.session.activeOrganizationId,
				);

				const admin = await findUserById(ctx.user.ownerId);

				if (admin.serversQuantity === 0 && IS_CLOUD) {
					throw new NotFoundError(
						"No servers available, Please subscribe to a plan",
					);
				}

				const project = await createProject(
					{
						name: input.name,
						...(input.description !== undefined
							? { description: input.description }
							: {}),
						...(input.env !== undefined ? { env: input.env } : {}),
					},
					ctx.session.activeOrganizationId,
				);
				await addNewProject(
					ctx.user.id,
					project.project.projectId,
					ctx.session.activeOrganizationId,
				);

				await addNewEnvironment(
					ctx.user.id,
					project?.environment?.environmentId || "",
					ctx.session.activeOrganizationId,
				);

				console.info("[audit] project.create", {
					action: "create",
					resourceType: "project",
					resourceId: project.project.projectId,
					resourceName: project.project.name,
				});
				return project;
			} catch (error) {
				throw new BadRequestError(
					`Error creating the project: ${error instanceof Error ? error.message : error}`,
				);
			}
		}

		case ProjectMethod.one: {
			const input = decodeArgs<{ projectId: string }>(call.payload);
			if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
				const { accessedServices, accessedProjects } = await findMemberByUserId(
					ctx.user.id,
					ctx.session.activeOrganizationId,
				);

				if (!accessedProjects.includes(input.projectId)) {
					throw new UnauthorizedError(
						"You don't have access to this project",
					);
				}

				const project = await db.query.projects.findFirst({
					where: and(
						eq(projects.projectId, input.projectId),
						eq(projects.organizationId, ctx.session.activeOrganizationId),
					),
					with: {
						environments: {
							with: {
								applications: {
									where: buildServiceFilter(
										applications.applicationId,
										accessedServices,
									),
								},
								compose: {
									where: buildServiceFilter(
										compose.composeId,
										accessedServices,
									),
								},
								libsql: {
									where: buildServiceFilter(libsql.libsqlId, accessedServices),
								},
								mariadb: {
									where: buildServiceFilter(
										mariadb.mariadbId,
										accessedServices,
									),
								},
								mongo: {
									where: buildServiceFilter(mongo.mongoId, accessedServices),
								},
								mysql: {
									where: buildServiceFilter(mysql.mysqlId, accessedServices),
								},
								postgres: {
									where: buildServiceFilter(
										postgres.postgresId,
										accessedServices,
									),
								},
								redis: {
									where: buildServiceFilter(redis.redisId, accessedServices),
								},
							},
						},
						projectTags: {
							with: {
								tag: true,
							},
						},
					},
				});

				if (!project) {
					throw new NotFoundError("Project not found");
				}
				return project;
			}
			const project = await findProjectById(input.projectId);

			if (project.organizationId !== ctx.session.activeOrganizationId) {
				throw new UnauthorizedError(
					"You are not authorized to access this project",
				);
			}
			return project;
		}

		case ProjectMethod.all: {
			if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
				const { accessedProjects, accessedEnvironments, accessedServices } =
					await findMemberByUserId(
						ctx.user.id,
						ctx.session.activeOrganizationId,
					);

				if (accessedProjects.length === 0) {
					return [];
				}

				const environmentFilter =
					accessedEnvironments.length === 0
						? sql`false`
						: sql`${environments.environmentId} IN (${sql.join(
								accessedEnvironments.map((envId: string) => sql`${envId}`),
								sql`, `,
							)})`;

				return await db.query.projects.findMany({
					where: and(
						sql`${projects.projectId} IN (${sql.join(
							accessedProjects.map((projectId: string) => sql`${projectId}`),
							sql`, `,
						)})`,
						eq(projects.organizationId, ctx.session.activeOrganizationId),
					),
					with: {
						environments: {
							where: environmentFilter,
							with: {
								applications: {
									where: buildServiceFilter(
										applications.applicationId,
										accessedServices,
									),
									columns: {
										applicationId: true,
										name: true,
										applicationStatus: true,
									},
								},
								libsql: {
									where: buildServiceFilter(libsql.libsqlId, accessedServices),
									columns: {
										libsqlId: true,
										name: true,
										applicationStatus: true,
									},
								},
								mariadb: {
									where: buildServiceFilter(mariadb.mariadbId, accessedServices),
									columns: {
										mariadbId: true,
										name: true,
										applicationStatus: true,
									},
								},
								mongo: {
									where: buildServiceFilter(mongo.mongoId, accessedServices),
									columns: {
										mongoId: true,
										name: true,
										applicationStatus: true,
									},
								},
								mysql: {
									where: buildServiceFilter(mysql.mysqlId, accessedServices),
									columns: {
										mysqlId: true,
										name: true,
										applicationStatus: true,
									},
								},
								postgres: {
									where: buildServiceFilter(
										postgres.postgresId,
										accessedServices,
									),
									columns: {
										postgresId: true,
										name: true,
										applicationStatus: true,
									},
								},
								redis: {
									where: buildServiceFilter(redis.redisId, accessedServices),
									columns: {
										redisId: true,
										name: true,
										applicationStatus: true,
									},
								},
								compose: {
									where: buildServiceFilter(compose.composeId, accessedServices),
									columns: {
										composeId: true,
										name: true,
										composeStatus: true,
									},
								},
							},
							columns: {
								environmentId: true,
								isDefault: true,
								name: true,
							},
						},
						projectTags: {
							with: {
								tag: true,
							},
						},
					},
					orderBy: desc(projects.createdAt),
				});
			}

			return await db.query.projects.findMany({
				with: {
					environments: {
						with: {
							applications: {
								columns: {
									applicationId: true,
									name: true,
									applicationStatus: true,
								},
							},
							mariadb: {
								columns: {
									mariadbId: true,
								},
							},
							mongo: {
								columns: {
									mongoId: true,
								},
							},
							mysql: {
								columns: {
									mysqlId: true,
								},
							},
							postgres: {
								columns: {
									postgresId: true,
								},
							},
							redis: {
								columns: {
									redisId: true,
								},
							},
							compose: {
								columns: {
									composeId: true,
									name: true,
									composeStatus: true,
								},
							},
							libsql: {
								columns: {
									libsqlId: true,
								},
							},
						},
						columns: {
							name: true,
							environmentId: true,
							isDefault: true,
						},
					},
					projectTags: {
						with: {
							tag: true,
						},
					},
				},
				where: eq(projects.organizationId, ctx.session.activeOrganizationId),
				orderBy: desc(projects.createdAt),
			});
		}

		case ProjectMethod.allForPermissions: {
			requireAdmin(ctx);
			return await db.query.projects.findMany({
				where: eq(projects.organizationId, ctx.session.activeOrganizationId),
				orderBy: desc(projects.createdAt),
				columns: {
					projectId: true,
					name: true,
				},
				with: {
					environments: {
						columns: {
							environmentId: true,
							name: true,
							isDefault: true,
						},
						with: {
							applications: {
								columns: {
									applicationId: true,
									appName: true,
									name: true,
									createdAt: true,
									applicationStatus: true,
									description: true,
									serverId: true,
								},
							},
							mariadb: {
								columns: {
									mariadbId: true,
									appName: true,
									name: true,
									createdAt: true,
									applicationStatus: true,
									description: true,
									serverId: true,
								},
							},
							postgres: {
								columns: {
									postgresId: true,
									appName: true,
									name: true,
									createdAt: true,
									applicationStatus: true,
									description: true,
									serverId: true,
								},
							},
							mysql: {
								columns: {
									mysqlId: true,
									appName: true,
									name: true,
									createdAt: true,
									applicationStatus: true,
									description: true,
									serverId: true,
								},
							},
							mongo: {
								columns: {
									mongoId: true,
									appName: true,
									name: true,
									createdAt: true,
									applicationStatus: true,
									description: true,
									serverId: true,
								},
							},
							redis: {
								columns: {
									redisId: true,
									appName: true,
									name: true,
									createdAt: true,
									applicationStatus: true,
									description: true,
									serverId: true,
								},
							},
							compose: {
								columns: {
									composeId: true,
									appName: true,
									name: true,
									createdAt: true,
									composeStatus: true,
									description: true,
									serverId: true,
								},
							},
							libsql: {
								columns: {
									libsqlId: true,
									appName: true,
									name: true,
									createdAt: true,
									applicationStatus: true,
									description: true,
									serverId: true,
								},
							},
						},
					},
				},
			});
		}

		case ProjectMethod.homeStats: {
			const isPrivileged =
				ctx.user.role === "owner" || ctx.user.role === "admin";

			let accessedProjects: string[] = [];
			let accessedEnvironments: string[] = [];
			let accessedServices: string[] = [];

			if (!isPrivileged) {
				const member = await findMemberByUserId(
					ctx.user.id,
					ctx.session.activeOrganizationId,
				);
				accessedProjects = member.accessedProjects;
				accessedEnvironments = member.accessedEnvironments;
				accessedServices = member.accessedServices;

				if (accessedProjects.length === 0) {
					return {
						projects: 0,
						environments: 0,
						applications: 0,
						compose: 0,
						databases: 0,
						services: 0,
						status: { running: 0, error: 0, idle: 0 },
					};
				}
			}

			const projectIdFilter = isPrivileged
				? eq(projects.organizationId, ctx.session.activeOrganizationId)
				: and(
						sql`${projects.projectId} IN (${sql.join(
							accessedProjects.map((id) => sql`${id}`),
							sql`, `,
						)})`,
						eq(projects.organizationId, ctx.session.activeOrganizationId),
					);

			const environmentFilter = isPrivileged
				? undefined
				: accessedEnvironments.length === 0
					? sql`false`
					: sql`${environments.environmentId} IN (${sql.join(
							accessedEnvironments.map((envId) => sql`${envId}`),
							sql`, `,
						)})`;

			const applyFilter = (col: AnySQLiteColumn) =>
				isPrivileged ? undefined : buildServiceFilter(col, accessedServices);

			const rows = await db.query.projects.findMany({
				where: projectIdFilter,
				columns: { projectId: true },
				with: {
					environments: {
						where: environmentFilter,
						columns: { environmentId: true },
						with: {
							applications: {
								where: applyFilter(applications.applicationId),
								columns: { applicationStatus: true },
							},
							compose: {
								where: applyFilter(compose.composeId),
								columns: { composeStatus: true },
							},
							libsql: {
								where: applyFilter(libsql.libsqlId),
								columns: { applicationStatus: true },
							},
							mariadb: {
								where: applyFilter(mariadb.mariadbId),
								columns: { applicationStatus: true },
							},
							mongo: {
								where: applyFilter(mongo.mongoId),
								columns: { applicationStatus: true },
							},
							mysql: {
								where: applyFilter(mysql.mysqlId),
								columns: { applicationStatus: true },
							},
							postgres: {
								where: applyFilter(postgres.postgresId),
								columns: { applicationStatus: true },
							},
							redis: {
								where: applyFilter(redis.redisId),
								columns: { applicationStatus: true },
							},
						},
					},
				},
			});

			let applicationsCount = 0;
			let composeCount = 0;
			let databasesCount = 0;
			let environmentsCount = 0;
			const status = { running: 0, error: 0, idle: 0 };
			const bump = (s?: string | null) => {
				if (s === "done") status.running++;
				else if (s === "error") status.error++;
				else status.idle++;
			};

			for (const project of rows) {
				for (const env of project.environments) {
					environmentsCount++;
					applicationsCount += env.applications.length;
					composeCount += env.compose.length;
					databasesCount +=
						env.libsql.length +
						env.mariadb.length +
						env.mongo.length +
						env.mysql.length +
						env.postgres.length +
						env.redis.length;

					for (const a of env.applications) bump(a.applicationStatus);
					for (const c of env.compose) bump(c.composeStatus);
					for (const s of env.libsql) bump(s.applicationStatus);
					for (const s of env.mariadb) bump(s.applicationStatus);
					for (const s of env.mongo) bump(s.applicationStatus);
					for (const s of env.mysql) bump(s.applicationStatus);
					for (const s of env.postgres) bump(s.applicationStatus);
					for (const s of env.redis) bump(s.applicationStatus);
				}
			}

			return {
				projects: rows.length,
				environments: environmentsCount,
				applications: applicationsCount,
				compose: composeCount,
				databases: databasesCount,
				services: applicationsCount + composeCount + databasesCount,
				status,
			};
		}

		case ProjectMethod.search: {
			const input = decodeArgs<{
				q?: string;
				name?: string;
				description?: string;
				limit: number;
				offset: number;
			}>(call.payload);
			const baseConditions = [
				eq(projects.organizationId, ctx.session.activeOrganizationId),
			];

			if (input.q?.trim()) {
				const term = `%${input.q.trim()}%`;
				baseConditions.push(
					or(
						ilike(projects.name, term),
						ilike(projects.description ?? "", term),
					)!,
				);
			}

			if (input.name?.trim()) {
				baseConditions.push(ilike(projects.name, `%${input.name.trim()}%`));
			}
			if (input.description?.trim()) {
				baseConditions.push(
					ilike(projects.description ?? "", `%${input.description.trim()}%`),
				);
			}

			if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
				const { accessedProjects } = await findMemberByUserId(
					ctx.user.id,
					ctx.session.activeOrganizationId,
				);
				if (accessedProjects.length === 0) return { items: [], total: 0 };
				baseConditions.push(
					sql`${projects.projectId} IN (${sql.join(
						accessedProjects.map((id: string) => sql`${id}`),
						sql`, `,
					)})`,
				);
			}

			const where = and(...baseConditions);

			const [items, countResult] = await Promise.all([
				db.query.projects.findMany({
					where,
					limit: input.limit,
					offset: input.offset,
					orderBy: desc(projects.createdAt),
					columns: {
						projectId: true,
						name: true,
						description: true,
						createdAt: true,
						organizationId: true,
						env: true,
					},
				}),
				db
					.select({ count: sql<number>`count(*)::int` })
					.from(projects)
					.where(where),
			]);

			return {
				items,
				total: countResult[0]?.count ?? 0,
			};
		}

		case ProjectMethod.remove: {
			const input = decodeArgs<{ projectId: string }>(call.payload);
			const currentProject = await findProjectById(input.projectId);
			if (currentProject.organizationId !== ctx.session.activeOrganizationId) {
				throw new UnauthorizedError(
					"You are not authorized to delete this project",
				);
			}
			await checkProjectAccess(
				ctx.user.id,
				"delete",
				ctx.session.activeOrganizationId,
				input.projectId,
			);
			const deletedProject = await deleteProject(input.projectId);

			console.info("[audit] project.delete", {
				action: "delete",
				resourceType: "project",
				resourceId: currentProject.projectId,
				resourceName: currentProject.name,
			});
			return deletedProject;
		}

		case ProjectMethod.update: {
			const input = decodeArgs<{
				projectId: string;
				env?: string;
				[k: string]: unknown;
			}>(call.payload);
			const currentProject = await findProjectById(input.projectId);
			if (currentProject.organizationId !== ctx.session.activeOrganizationId) {
				throw new UnauthorizedError(
					"You are not authorized to update this project",
				);
			}

			if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
				const { accessedProjects } = await findMemberByUserId(
					ctx.user.id,
					ctx.session.activeOrganizationId,
				);
				if (!accessedProjects.includes(input.projectId)) {
					throw new UnauthorizedError(
						"You don't have access to this project",
					);
				}
			}

			if (input.env !== undefined) {
				await checkPermission(ctx, { projectEnvVars: ["write"] });
			}

			const project = await updateProjectById(input.projectId, {
				...input,
			});

			if (project) {
				console.info("[audit] project.update", {
					action: "update",
					resourceType: "project",
					resourceId: input.projectId,
					resourceName: project.name,
				});
			}
			return project;
		}

		case ProjectMethod.duplicate: {
			// biome-ignore lint/suspicious/noExplicitAny: duplicate input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			try {
				await checkProjectAccess(
					ctx.user.id,
					"create",
					ctx.session.activeOrganizationId,
				);

				const sourceEnvironment = input.duplicateInSameProject
					? await findEnvironmentById(input.sourceEnvironmentId)
					: null;

				if (
					input.duplicateInSameProject &&
					sourceEnvironment?.project.organizationId !==
						ctx.session.activeOrganizationId
				) {
					throw new UnauthorizedError(
						"You are not authorized to access this project",
					);
				}

				if (
					input.duplicateInSameProject &&
					sourceEnvironment &&
					ctx.user.role !== "owner" &&
					ctx.user.role !== "admin"
				) {
					const { accessedProjects } = await findMemberByUserId(
						ctx.user.id,
						ctx.session.activeOrganizationId,
					);
					if (!accessedProjects.includes(sourceEnvironment.project.projectId)) {
						throw new UnauthorizedError(
							"You don't have access to this project",
						);
					}
				}

				const targetProject = input.duplicateInSameProject
					? sourceEnvironment
					: await createProject(
							{
								name: input.name,
								description: input.description,
								env: sourceEnvironment?.project.env,
							},
							ctx.session.activeOrganizationId,
						).then((value) => value.environment);

				if (input.includeServices) {
					const servicesToDuplicate = input.selectedServices || [];

					const duplicateService = async (id: string, type: string) => {
						switch (type) {
							case "application": {
								const {
									applicationId,
									domains,
									security,
									ports,
									registry,
									redirects,
									previewDeployments,
									mounts,
									appName,
									refreshToken,
									...application
								} = await findApplicationById(id);
								const newAppName = appName.substring(
									0,
									appName.lastIndexOf("-"),
								);

								const newApplication = await createApplication({
									...application,
									appName: newAppName,
									name: input.duplicateInSameProject
										? `${application.name} (copy)`
										: application.name,
									environmentId: targetProject?.environmentId || "",
								});

								for (const domain of domains) {
									const { domainId, ...rest } = domain;
									await createDomain({
										...rest,
										applicationId: newApplication.applicationId,
										domainType: "application",
									});
								}

								for (const port of ports) {
									const { portId, ...rest } = port;
									await createPort({
										...rest,
										applicationId: newApplication.applicationId,
									});
								}

								for (const mount of mounts) {
									const { mountId, ...rest } = mount;
									await createMount({
										...rest,
										serviceId: newApplication.applicationId,
										serviceType: "application",
									});
								}

								for (const redirect of redirects) {
									const { redirectId, ...rest } = redirect;
									await createRedirect({
										...rest,
										applicationId: newApplication.applicationId,
									});
								}

								for (const secure of security) {
									const { securityId, ...rest } = secure;
									await createSecurity({
										...rest,
										applicationId: newApplication.applicationId,
									});
								}

								for (const previewDeployment of previewDeployments) {
									const { previewDeploymentId, ...rest } = previewDeployment;
									await createPreviewDeployment({
										...rest,
										applicationId: newApplication.applicationId,
										domainId: undefined,
									});
								}

								break;
							}
							case "compose": {
								const {
									composeId,
									mounts,
									domains,
									appName,
									refreshToken,
									...compose
								} = await findComposeById(id);

								const newAppName = appName.substring(
									0,
									appName.lastIndexOf("-"),
								);

								const newCompose = await createCompose({
									...compose,
									appName: newAppName,
									name: input.duplicateInSameProject
										? `${compose.name} (copy)`
										: compose.name,
									environmentId: targetProject?.environmentId || "",
								});

								for (const mount of mounts) {
									const { mountId, ...rest } = mount;
									await createMount({
										...rest,
										serviceId: newCompose.composeId,
										serviceType: "compose",
									});
								}

								for (const domain of domains) {
									const { domainId, ...rest } = domain;
									await createDomain({
										...rest,
										composeId: newCompose.composeId,
										domainType: "compose",
									});
								}

								break;
							}
							case "libsql": {
								const { libsqlId, mounts, appName, ...libsql } =
									await findLibsqlById(id);

								const newAppName = appName.substring(
									0,
									appName.lastIndexOf("-"),
								);

								const newLibsql = await createLibsql({
									...libsql,
									appName: newAppName,
									name: input.duplicateInSameProject
										? `${libsql.name} (copy)`
										: libsql.name,
									environmentId: targetProject?.environmentId || "",
								});

								for (const mount of mounts) {
									const { mountId, ...rest } = mount;
									await createMount({
										...rest,
										serviceId: newLibsql.libsqlId,
										serviceType: "libsql",
									});
								}

								break;
							}
							case "mariadb": {
								const { mariadbId, mounts, backups, appName, ...mariadb } =
									await findMariadbById(id);

								const newAppName = appName.substring(
									0,
									appName.lastIndexOf("-"),
								);

								const newMariadb = await createMariadb({
									...mariadb,
									appName: newAppName,
									name: input.duplicateInSameProject
										? `${mariadb.name} (copy)`
										: mariadb.name,
									environmentId: targetProject?.environmentId || "",
								});

								for (const mount of mounts) {
									const { mountId, ...rest } = mount;
									await createMount({
										...rest,
										serviceId: newMariadb.mariadbId,
										serviceType: "mariadb",
									});
								}

								for (const backup of backups) {
									const { backupId, appName: _appName, ...rest } = backup;
									await createBackup({
										...rest,
										mariadbId: newMariadb.mariadbId,
									});
								}
								break;
							}
							case "mongo": {
								const { mongoId, mounts, backups, appName, ...mongo } =
									await findMongoById(id);

								const newAppName = appName.substring(
									0,
									appName.lastIndexOf("-"),
								);

								const newMongo = await createMongo({
									...mongo,
									appName: newAppName,
									name: input.duplicateInSameProject
										? `${mongo.name} (copy)`
										: mongo.name,
									environmentId: targetProject?.environmentId || "",
								});

								for (const mount of mounts) {
									const { mountId, ...rest } = mount;
									await createMount({
										...rest,
										serviceId: newMongo.mongoId,
										serviceType: "mongo",
									});
								}

								for (const backup of backups) {
									const { backupId, appName: _appName, ...rest } = backup;
									await createBackup({
										...rest,
										mongoId: newMongo.mongoId,
									});
								}
								break;
							}
							case "mysql": {
								const { mysqlId, mounts, backups, appName, ...mysql } =
									await findMySqlById(id);

								const newAppName = appName.substring(
									0,
									appName.lastIndexOf("-"),
								);

								const newMysql = await createMysql({
									...mysql,
									appName: newAppName,
									name: input.duplicateInSameProject
										? `${mysql.name} (copy)`
										: mysql.name,
									environmentId: targetProject?.environmentId || "",
								});

								for (const mount of mounts) {
									const { mountId, ...rest } = mount;
									await createMount({
										...rest,
										serviceId: newMysql.mysqlId,
										serviceType: "mysql",
									});
								}

								for (const backup of backups) {
									const { backupId, appName: _appName, ...rest } = backup;
									await createBackup({
										...rest,
										mysqlId: newMysql.mysqlId,
									});
								}
								break;
							}
							case "postgres": {
								const { postgresId, mounts, backups, appName, ...postgres } =
									await findPostgresById(id);

								const newAppName = appName.substring(
									0,
									appName.lastIndexOf("-"),
								);

								const newPostgres = await createPostgres({
									...postgres,
									appName: newAppName,
									name: input.duplicateInSameProject
										? `${postgres.name} (copy)`
										: postgres.name,
									environmentId: targetProject?.environmentId || "",
								});

								for (const mount of mounts) {
									const { mountId, ...rest } = mount;
									await createMount({
										...rest,
										serviceId: newPostgres.postgresId,
										serviceType: "postgres",
									});
								}

								for (const backup of backups) {
									const { backupId, ...rest } = backup;
									await createBackup({
										...rest,
										postgresId: newPostgres.postgresId,
									});
								}
								break;
							}
							case "redis": {
								const { redisId, mounts, appName, ...redis } =
									await findRedisById(id);

								const newAppName = appName.substring(
									0,
									appName.lastIndexOf("-"),
								);

								const newRedis = await createRedis({
									...redis,
									appName: newAppName,
									name: input.duplicateInSameProject
										? `${redis.name} (copy)`
										: redis.name,
									environmentId: targetProject?.environmentId || "",
								});

								for (const mount of mounts) {
									const { mountId, ...rest } = mount;
									await createMount({
										...rest,
										serviceId: newRedis.redisId,
										serviceType: "redis",
									});
								}

								break;
							}
						}
					};

					for (const service of servicesToDuplicate) {
						await duplicateService(service.id, service.type);
					}
				}

				if (!input.duplicateInSameProject) {
					await addNewProject(
						ctx.user.id,
						targetProject?.projectId || "",
						ctx.session.activeOrganizationId,
					);
				}

				console.info("[audit] project.create", {
					action: "create",
					resourceType: "project",
					resourceId: targetProject?.projectId || "",
					resourceName: input.name,
					metadata: { duplicatedFrom: input.sourceEnvironmentId },
				});
				return targetProject;
			} catch (error) {
				throw new BadRequestError(
					`Error duplicating the project: ${error instanceof Error ? error.message : error}`,
				);
			}
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
