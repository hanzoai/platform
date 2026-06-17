// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// cluster-cap.ts — the native @zap-proto/web Cluster capability.
//
// Binary-ZAP replacement for the tRPC `clusterRouter`
// (server/api/routers/cluster.ts). Every method was `withPermission("server",
// <action>)` — an authenticated caller (session+user) whose body additionally
// enforces per-server org ownership. The mint boundary requires session+user
// (a null return rejects the WS upgrade with HTTP 401, mirroring
// protectedProcedure); the per-server ownership check is enforced INSIDE
// dispatch, verbatim from the original procedure bodies. Inputs ride the shared
// Args carrier, results the shared Result carrier; ClusterMethod ordinals are
// generated from cluster.zap.

import type { IncomingMessage } from "node:http";
import {
	type DockerNode,
	execAsync,
	execAsyncRemote,
	findServerById,
	getRemoteDocker,
} from "@hanzo/platform";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { getLocalServerIp } from "@/server/wss/terminal";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { ClusterMethod } from "./schema/cluster_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface ClusterCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
}

/**
 * clusterMintCap — bearer→ctx boundary. Mirrors `withPermission("server", …)`'s
 * authentication half (a `protectedProcedure` base): validates the upgrade and
 * requires session+user. Null → HTTP 401 before any socket opens. The
 * per-server org-ownership half runs inside dispatch (verbatim from the bodies).
 */
export const clusterMintCap: MintCap<ClusterCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as ClusterCtx["userRole"];
	const userId = (user as { id?: string }).id || "";
	return { organizationId, userRole, userId };
};

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed internal failure → ZAP Status.Internal. */
class InternalError extends Error {}

/**
 * verifyServerOwnership — verbatim port of the per-procedure guard: when a
 * serverId is supplied, the target server must belong to the caller's active
 * organization, else UNAUTHORIZED.
 */
async function verifyServerOwnership(
	serverId: string | undefined,
	organizationId: string,
): Promise<void> {
	if (!serverId) return;
	const targetServer = await findServerById(serverId);
	if (targetServer.organizationId !== organizationId) {
		throw new UnauthorizedError("You don't have access to this server.");
	}
}

/**
 * clusterRootCap — dispatch each decoded Call by ClusterMethod ordinal to the
 * same Docker-swarm service calls the tRPC procedure ran. Inputs decode via the
 * shared Args carrier; results encode via the shared Result carrier.
 */
export function clusterRootCap(ctx: ClusterCtx): CallHandler {
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

async function dispatch(ctx: ClusterCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case ClusterMethod.getNodes: {
			const input = decodeArgs<{ serverId?: string }>(call.payload) ?? {};
			await verifyServerOwnership(input.serverId, ctx.organizationId);
			const docker = await getRemoteDocker(input.serverId);
			const workers: DockerNode[] = await docker.listNodes();
			return workers;
		}
		case ClusterMethod.removeWorker: {
			const input = decodeArgs<{ nodeId: string; serverId?: string }>(
				call.payload,
			);
			await verifyServerOwnership(input.serverId, ctx.organizationId);
			try {
				const drainCommand = `docker node update --availability drain ${input.nodeId}`;
				const removeCommand = `docker node rm ${input.nodeId} --force`;

				if (input.serverId) {
					await execAsyncRemote(input.serverId, drainCommand);
					await execAsyncRemote(input.serverId, removeCommand);
				} else {
					await execAsync(drainCommand);
					await execAsync(removeCommand);
				}
				console.info("[audit] cluster.delete", {
					action: "delete",
					resourceType: "cluster",
					resourceId: input.nodeId,
					resourceName: input.nodeId,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				return true;
			} catch (error) {
				throw new InternalError(
					`Error removing the node: ${(error as Error).message}`,
				);
			}
		}
		case ClusterMethod.addWorker: {
			const input = decodeArgs<{ serverId?: string }>(call.payload) ?? {};
			await verifyServerOwnership(input.serverId, ctx.organizationId);
			const docker = await getRemoteDocker(input.serverId);
			const result = await docker.swarmInspect();
			const docker_version = await docker.version();

			let ip = await getLocalServerIp();
			if (input.serverId) {
				const server = await findServerById(input.serverId);
				ip = server?.ipAddress;
			}

			return {
				command: `docker swarm join --token ${result.JoinTokens.Worker} ${ip}:2377`,
				version: docker_version.Version,
			};
		}
		case ClusterMethod.addManager: {
			const input = decodeArgs<{ serverId?: string }>(call.payload) ?? {};
			await verifyServerOwnership(input.serverId, ctx.organizationId);
			const docker = await getRemoteDocker(input.serverId);
			const result = await docker.swarmInspect();
			const docker_version = await docker.version();

			let ip = await getLocalServerIp();
			if (input.serverId) {
				const server = await findServerById(input.serverId);
				ip = server?.ipAddress;
			}
			return {
				command: `docker swarm join --token ${result.JoinTokens.Manager} ${ip}:2377`,
				version: docker_version.Version,
			};
		}
		default:
			throw new InternalError(`unknown method ${call.method}`);
	}
}
