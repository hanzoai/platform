// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// deployment-cap.ts — the native @zap-proto/web Deployment capability.
//
// Binary-ZAP replacement for the tRPC `deploymentRouter`
// (server/api/routers/deployment.ts). Methods mix `protectedProcedure` and
// `withPermission("deployment", <action>)` — an authenticated caller (session+
// user) whose body additionally enforces per-service permission
// (checkServicePermissionAndAccess) or per-server org ownership. The mint
// boundary requires session+user (a null return rejects the WS upgrade with
// HTTP 401, mirroring protectedProcedure); the per-service / per-server checks
// are enforced INSIDE dispatch, verbatim from the original procedure bodies.
// Inputs ride the shared Args carrier, results the shared Result carrier;
// DeploymentMethod ordinals are generated from deployment.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// deployment.<action>", …)`, mirroring how registry-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	execAsync,
	execAsyncRemote,
	findAllDeploymentsByApplicationId,
	findAllDeploymentsByComposeId,
	findAllDeploymentsByServerId,
	findAllDeploymentsCentralized,
	findDeploymentById,
	findServerById,
	IS_CLOUD,
	removeDeployment,
	resolveServicePath,
	updateDeploymentStatus,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { validateRequest } from "@hanzo/platform/lib/auth";
import {
	checkServicePermissionAndAccess,
	findMemberByUserId,
} from "@hanzo/platform/services/permission";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { desc, eq } from "drizzle-orm";
import { deployments, server } from "@/server/db/schema";
import { myQueue } from "@/server/queues/queueSetup";
import { fetchDeployApiJobs, type QueueJobRow } from "@/server/utils/deploy";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { DeploymentMethod } from "./schema/deployment_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface DeploymentCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * deploymentMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication half (the base of both `protectedProcedure` and
 * `withPermission`): validates the upgrade and requires session+user. Null →
 * HTTP 401 before any socket opens. The per-service / per-server authorization
 * half runs inside dispatch (verbatim from the bodies).
 */
export const deploymentMintCap: MintCap<DeploymentCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as DeploymentCtx["userRole"];
	const userId = (user as { id?: string }).id || "";
	const email = (user as { email?: string }).email || "";
	return { organizationId, userRole, userId, email };
};

/**
 * permCtx — adapt the flat per-connection DeploymentCtx to the `PermissionCtx`
 * shape (`{ user: { id }, session: { activeOrganizationId } }`) that
 * checkServicePermissionAndAccess reads. The tRPC procedure passed its own
 * nested `ctx` directly; here the minted ctx is flat, so we reshape at the call
 * site. Same values, different access path.
 */
const permCtx = (ctx: DeploymentCtx) => ({
	user: { id: ctx.userId },
	session: { activeOrganizationId: ctx.organizationId },
});

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}

/**
 * deploymentRootCap — dispatch each decoded Call by DeploymentMethod ordinal to
 * the same service functions the tRPC procedure called. Inputs decode via the
 * shared Args carrier; results encode via the shared Result carrier. Errors map
 * to ZAP status codes (mirroring the tRPC error codes), never a thrown HTTP 500
 * leak.
 */
export function deploymentRootCap(ctx: DeploymentCtx): CallHandler {
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

async function dispatch(ctx: DeploymentCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case DeploymentMethod.all: {
			const input = decodeArgs<{ applicationId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.applicationId, {
				deployment: ["read"],
			});
			return await findAllDeploymentsByApplicationId(input.applicationId);
		}

		case DeploymentMethod.allByCompose: {
			const input = decodeArgs<{ composeId: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.composeId, {
				deployment: ["read"],
			});
			return await findAllDeploymentsByComposeId(input.composeId);
		}

		case DeploymentMethod.allByServer: {
			const input = decodeArgs<{ serverId: string }>(call.payload);
			const targetServer = await findServerById(input.serverId);
			if (targetServer.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError("You don't have access to this server.");
			}
			return await findAllDeploymentsByServerId(input.serverId);
		}

		case DeploymentMethod.allCentralized: {
			const orgId = ctx.organizationId;
			const accessedServices =
				ctx.userRole !== "owner" && ctx.userRole !== "admin"
					? (await findMemberByUserId(ctx.userId, orgId)).accessedServices
					: null;
			if (accessedServices !== null && accessedServices.length === 0) {
				return [];
			}
			return findAllDeploymentsCentralized(orgId, accessedServices);
		}

		case DeploymentMethod.queueList: {
			const orgId = ctx.organizationId;
			let rows: QueueJobRow[];

			if (IS_CLOUD) {
				const servers = await db.query.server.findMany({
					where: eq(server.organizationId, orgId),
					columns: { serverId: true },
				});
				const serverRowsArrays = await Promise.all(
					servers.map(({ serverId }) => fetchDeployApiJobs(serverId)),
				);
				rows = serverRowsArrays.flat();
				rows.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
			} else {
				const jobs = await myQueue.getJobs();
				const jobRows = await Promise.all(
					jobs.map(async (job) => {
						const state = await job.getState();
						return {
							id: String(job.id),
							name: job.name ?? undefined,
							data: job.data as Record<string, unknown>,
							timestamp: job.timestamp,
							processedOn: job.processedOn,
							finishedOn: job.finishedOn,
							failedReason: job.failedReason ?? undefined,
							state,
						};
					}),
				);
				jobRows.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
				rows = jobRows;
			}

			return Promise.all(
				rows.map(async (row) => ({
					...row,
					servicePath: await resolveServicePath(
						orgId,
						(row.data ?? {}) as Record<string, unknown>,
					),
				})),
			);
		}

		case DeploymentMethod.allByType: {
			const input = decodeArgs<{ id: string; type: string }>(call.payload);
			await checkServicePermissionAndAccess(permCtx(ctx), input.id, {
				deployment: ["read"],
			});
			const deploymentsList = await db.query.deployments.findMany({
				where: eq(deployments[`${input.type}Id`], input.id),
				orderBy: desc(deployments.createdAt),
				with: {
					rollback: true,
				},
			});
			return deploymentsList;
		}

		case DeploymentMethod.killProcess: {
			const input = decodeArgs<{ deploymentId: string }>(call.payload);
			const deployment = await findDeploymentById(input.deploymentId);
			const serviceId = deployment.applicationId || deployment.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(permCtx(ctx), serviceId, {
					deployment: ["cancel"],
				});
			} else if (deployment.schedule?.serverId) {
				const targetServer = await findServerById(deployment.schedule.serverId);
				if (targetServer.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You don't have access to this deployment.",
					);
				}
			}

			if (!deployment.pid) {
				throw new BadRequestError("Deployment is not running");
			}

			const command = `kill -9 ${deployment.pid}`;
			if (deployment.schedule?.serverId) {
				await execAsyncRemote(deployment.schedule.serverId, command);
			} else {
				await execAsync(command);
			}

			await updateDeploymentStatus(deployment.deploymentId, "error");
			console.info("[audit] deployment.cancel", {
				action: "cancel",
				resourceType: "deployment",
				resourceId: deployment.deploymentId,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return undefined;
		}

		case DeploymentMethod.removeDeployment: {
			const input = decodeArgs<{ deploymentId: string }>(call.payload);
			const deployment = await findDeploymentById(input.deploymentId);
			const serviceId = deployment.applicationId || deployment.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(permCtx(ctx), serviceId, {
					deployment: ["cancel"],
				});
			} else if (deployment.schedule?.serverId) {
				const targetServer = await findServerById(deployment.schedule.serverId);
				if (targetServer.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You don't have access to this deployment.",
					);
				}
			}
			const result = await removeDeployment(input.deploymentId);
			console.info("[audit] deployment.delete", {
				action: "delete",
				resourceType: "deployment",
				resourceId: deployment.deploymentId,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return result;
		}

		case DeploymentMethod.readLogs: {
			const input = decodeArgs<{ deploymentId: string; tail: number }>(
				call.payload,
			);
			const deployment = await findDeploymentById(input.deploymentId);
			const serviceId = deployment.applicationId || deployment.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(permCtx(ctx), serviceId, {
					deployment: ["read"],
				});
			} else if (deployment.schedule?.serverId) {
				const targetServer = await findServerById(deployment.schedule.serverId);
				if (targetServer.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You don't have access to this deployment.",
					);
				}
			}

			if (!deployment.logPath) {
				return "";
			}

			const command = `tail -n ${input.tail} "${deployment.logPath}" 2>/dev/null || echo ""`;
			const serverId = deployment.serverId || deployment.schedule?.serverId;
			if (serverId) {
				const { stdout } = await execAsyncRemote(serverId, command);
				return stdout;
			}

			if (IS_CLOUD) {
				return "";
			}

			const { stdout } = await execAsync(command);
			return stdout;
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
