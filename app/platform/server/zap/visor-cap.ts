// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// visor-cap.ts — the native @zap-proto/web Visor capability.
//
// Binary-ZAP replacement for the tRPC `visorRouter`
// (server/api/routers/visor.ts). Every method was a `protectedProcedure`
// (authenticated caller, session+user) that forwards the user's IAM bearer
// token to the Visor service, scoped by the session's activeOrganizationId.
// The mint boundary requires session+user (a null return rejects the WS
// upgrade with HTTP 401, mirroring protectedProcedure); the bearer token is
// extracted from the upgrade request inside dispatch, verbatim from the
// original `extractToken(ctx.req)` helper. Inputs ride the shared Args carrier,
// results the shared Result carrier; VisorMethod ordinals are generated from
// visor.zap.

import type { IncomingMessage } from "node:http";
import {
	visorCreateMachine,
	visorCreateVolume,
	visorDeleteMachine,
	visorDeleteVolume,
	visorGetMachine,
	visorListMachines,
	visorListNodePools,
	visorListPlans,
	visorListProviders,
	visorListVolumes,
	visorUpdateMachine,
} from "@hanzo/platform/services/visor";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { VisorMethod } from "./schema/visor_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface VisorCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
	token: string;
}

/**
 * visorMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication half: validates the upgrade and requires session+user. Null →
 * HTTP 401 before any socket opens. The IAM bearer token forwarded to the Visor
 * service is extracted from the upgrade request here (verbatim from the original
 * `extractToken(ctx.req)`).
 */
export const visorMintCap: MintCap<VisorCtx> = async (req: IncomingMessage) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as VisorCtx["userRole"];
	const userId = (user as { id?: string }).id || "";
	const email = (user as { email?: string }).email || "";
	const token = extractToken(req);
	return { organizationId, userRole, userId, email, token };
};

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}

/**
 * Extract the Bearer token from the incoming HTTP request.
 * Falls back to cookie-based session token if no Authorization header.
 */
function extractToken(req: {
	headers: Record<string, string | string[] | undefined>;
}): string {
	const authHeader = req.headers.authorization;
	if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
		return authHeader.slice(7);
	}
	throw new UnauthorizedError("Missing Bearer token for Visor API proxy");
}

/**
 * visorRootCap — dispatch each decoded Call by VisorMethod ordinal to the same
 * service functions the tRPC procedure called. Inputs decode via the shared Args
 * carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function visorRootCap(ctx: VisorCtx): CallHandler {
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

async function dispatch(ctx: VisorCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case VisorMethod.listMachines: {
			return visorListMachines(ctx.organizationId, ctx.token);
		}

		case VisorMethod.getMachine: {
			const input = decodeArgs<{ name: string }>(call.payload);
			return visorGetMachine(ctx.organizationId, input.name, ctx.token);
		}

		case VisorMethod.createMachine: {
			const input = decodeArgs<{
				name: string;
				provider: string;
				region: string;
				size: string;
				image?: string;
				labels?: Record<string, string>;
				userData?: string;
			}>(call.payload);
			return visorCreateMachine(
				{
					owner: ctx.organizationId,
					...input,
				},
				ctx.token,
			);
		}

		case VisorMethod.updateMachine: {
			const input = decodeArgs<{
				name: string;
				size?: string;
				labels?: Record<string, string>;
			}>(call.payload);
			return visorUpdateMachine(
				{
					owner: ctx.organizationId,
					...input,
				},
				ctx.token,
			);
		}

		case VisorMethod.deleteMachine: {
			const input = decodeArgs<{ name: string }>(call.payload);
			return visorDeleteMachine(ctx.organizationId, input.name, ctx.token);
		}

		case VisorMethod.listProviders: {
			return visorListProviders(ctx.organizationId, ctx.token);
		}

		case VisorMethod.listPlans: {
			return visorListPlans(ctx.token);
		}

		case VisorMethod.listNodePools: {
			return visorListNodePools(ctx.organizationId, ctx.token);
		}

		case VisorMethod.listVolumes: {
			return visorListVolumes(ctx.organizationId, ctx.token);
		}

		case VisorMethod.createVolume: {
			const { provider, ...spec } = decodeArgs<{
				provider: string;
				name: string;
				size: number;
				region: string;
			}>(call.payload);
			// The org comes from the token, so the body is the volume and
			// nothing else.
			return visorCreateVolume(spec, provider, ctx.token);
		}

		case VisorMethod.deleteVolume: {
			const input = decodeArgs<{ name: string }>(call.payload);
			return visorDeleteVolume(ctx.organizationId, input.name, ctx.token);
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
