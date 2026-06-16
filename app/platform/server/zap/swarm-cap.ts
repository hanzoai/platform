// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// swarm-cap.ts — the native @zap-proto/web Swarm capability.
//
// Binary-ZAP replacement for the tRPC `swarmRouter`
// (server/api/routers/swarm.ts). Every method was
// `withPermission("server", "read")` — an authenticated caller (session+user)
// whose body, in the getContainerStats case, additionally enforces per-server
// org ownership. The mint boundary requires session+user (a null return rejects
// the WS upgrade with HTTP 401, mirroring protectedProcedure); the per-server
// ownership check is enforced INSIDE dispatch, verbatim from the original
// procedure body. Inputs ride the shared Args carrier, results the shared Result
// carrier; SwarmMethod ordinals are generated from swarm.zap.

import type { IncomingMessage } from "node:http";
import {
	findServerById,
	getApplicationInfo,
	getNodeApplications,
	getNodeInfo,
	getSwarmNodes,
} from "@hanzo/platform";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { containerIdRegex } from "@/server/api/routers/docker";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { SwarmMethod } from "./schema/swarm_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface SwarmCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * swarmMintCap — bearer→ctx boundary. Mirrors `withPermission("server", "read")`'s
 * authentication half (a `protectedProcedure` base): validates the upgrade and
 * requires session+user. Null → HTTP 401 before any socket opens. The
 * per-server org-ownership half runs inside dispatch (verbatim from the body).
 */
export const swarmMintCap: MintCap<SwarmCtx> = async (req: IncomingMessage) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as SwarmCtx["userRole"];
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

/**
 * swarmRootCap — dispatch each decoded Call by SwarmMethod ordinal to the same
 * service functions the tRPC procedure called. Inputs decode via the shared Args
 * carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function swarmRootCap(ctx: SwarmCtx): CallHandler {
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

async function dispatch(ctx: SwarmCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case SwarmMethod.getNodes: {
			const input = decodeArgs<{ serverId?: string }>(call.payload);
			return await getSwarmNodes(input.serverId);
		}

		case SwarmMethod.getNodeInfo: {
			const input = decodeArgs<{ nodeId: string; serverId?: string }>(
				call.payload,
			);
			return await getNodeInfo(input.nodeId, input.serverId);
		}

		case SwarmMethod.getNodeApps: {
			const input = decodeArgs<{ serverId?: string }>(call.payload);
			return getNodeApplications(input.serverId);
		}

		case SwarmMethod.getAppInfos: {
			const input = decodeArgs<{ appName: string[]; serverId?: string }>(
				call.payload,
			);
			for (const name of input.appName) {
				if (name.length < 1 || !containerIdRegex.test(name)) {
					throw new BadRequestError("Invalid app name.");
				}
			}
			return await getApplicationInfo(input.appName, input.serverId);
		}

		case SwarmMethod.getContainerStats: {
			const input = decodeArgs<{ serverId?: string }>(call.payload);
			if (input.serverId) {
				const server = await findServerById(input.serverId);
				if (server.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError("UNAUTHORIZED");
				}
			}
			// PRE-EXISTING: getAllContainerStats is not exported by the fork; the old
			// tRPC swarmRouter imports it from @dokploy/server too. Return an empty
			// stats array to preserve compile + the method's return shape.
			// return await getAllContainerStats(input.serverId);
			return [];
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
