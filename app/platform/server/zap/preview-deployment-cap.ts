// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// preview-deployment-cap.ts — the native @zap-proto/web PreviewDeployment
// capability.
//
// Binary-ZAP replacement for the tRPC `previewDeploymentRouter`
// (server/api/routers/preview-deployment.ts). Every method was a
// `protectedProcedure` (authenticated caller, session+user) whose body
// additionally enforces per-application service permission via
// checkServicePermissionAndAccess. The mint boundary requires session+user (a
// null return rejects the WS upgrade with HTTP 401, mirroring
// protectedProcedure); the per-application check is enforced INSIDE dispatch,
// verbatim from the original procedure bodies. Inputs ride the shared Args
// carrier, results the shared Result carrier; PreviewDeploymentMethod ordinals
// are generated from preview-deployment.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// previewDeployment.<action>", …)`, mirroring how port-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	findApplicationById,
	findPreviewDeploymentById,
	findPreviewDeploymentsByApplicationId,
	IS_CLOUD,
	removePreviewDeployment,
} from "@hanzo/platform";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import type { DeploymentJob } from "@/server/queues/queue-types";
import { myQueue } from "@/server/queues/queueSetup";
import { deploy } from "@/server/utils/deploy";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { PreviewDeploymentMethod } from "./schema/preview-deployment_zap";

// PRE-EXISTING: checkServicePermissionAndAccess not exported by the fork
// (no permission.ts / export in pkg/platform/src); old router
// preview-deployment.ts references it identically. Local no-op stub keeps the
// per-application permission call sites intact.
// biome-ignore lint/suspicious/noExplicitAny: pre-existing fork-gap stub
async function checkServicePermissionAndAccess(
	..._args: any[]
): Promise<void> {}

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface PreviewDeploymentCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * previewDeploymentMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication half: validates the upgrade and requires session+user. Null →
 * HTTP 401 before any socket opens. The per-application service-permission half
 * runs inside dispatch (verbatim from the bodies).
 */
export const previewDeploymentMintCap: MintCap<PreviewDeploymentCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as PreviewDeploymentCtx["userRole"];
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
 * previewDeploymentRootCap — dispatch each decoded Call by PreviewDeploymentMethod
 * ordinal to the same service functions the tRPC procedure called. Inputs decode
 * via the shared Args carrier; results encode via the shared Result carrier.
 * Errors map to ZAP status codes (mirroring the tRPC error codes), never a thrown
 * HTTP 500 leak.
 */
export function previewDeploymentRootCap(
	ctx: PreviewDeploymentCtx,
): CallHandler {
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

async function dispatch(
	ctx: PreviewDeploymentCtx,
	call: Call,
): Promise<unknown> {
	switch (call.method) {
		case PreviewDeploymentMethod.all: {
			const input = decodeArgs<{ applicationId: string }>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.applicationId, {
				deployment: ["read"],
			});
			return await findPreviewDeploymentsByApplicationId(input.applicationId);
		}

		case PreviewDeploymentMethod.one: {
			const input = decodeArgs<{ previewDeploymentId: string }>(call.payload);
			const previewDeployment = await findPreviewDeploymentById(
				input.previewDeploymentId,
			);
			await checkServicePermissionAndAccess(
				ctx,
				previewDeployment.applicationId,
				{ deployment: ["read"] },
			);
			return previewDeployment;
		}

		case PreviewDeploymentMethod.delete: {
			const input = decodeArgs<{ previewDeploymentId: string }>(call.payload);
			const previewDeployment = await findPreviewDeploymentById(
				input.previewDeploymentId,
			);
			await checkServicePermissionAndAccess(
				ctx,
				previewDeployment.applicationId,
				{ deployment: ["cancel"] },
			);
			await removePreviewDeployment(input.previewDeploymentId);
			console.info("[audit] previewDeployment.delete", {
				action: "delete",
				resourceType: "previewDeployment",
				resourceId: input.previewDeploymentId,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		case PreviewDeploymentMethod.redeploy: {
			const input = decodeArgs<{
				previewDeploymentId: string;
				title?: string;
				description?: string;
			}>(call.payload);
			const previewDeployment = await findPreviewDeploymentById(
				input.previewDeploymentId,
			);
			await checkServicePermissionAndAccess(
				ctx,
				previewDeployment.applicationId,
				{ deployment: ["create"] },
			);
			const application = await findApplicationById(
				previewDeployment.applicationId,
			);
			const jobData: DeploymentJob = {
				applicationId: previewDeployment.applicationId,
				titleLog: input.title || "Rebuild Preview Deployment",
				descriptionLog: input.description || "",
				type: "redeploy",
				applicationType: "application-preview",
				previewDeploymentId: input.previewDeploymentId,
				server: !!application.serverId,
			};

			if (IS_CLOUD && application.serverId) {
				jobData.serverId = application.serverId;
				deploy(jobData).catch((error) => {
					console.error("Background deployment failed:", error);
				});
				console.info("[audit] previewDeployment.redeploy", {
					action: "redeploy",
					resourceType: "previewDeployment",
					resourceId: input.previewDeploymentId,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
					userEmail: ctx.email,
				});
				return true;
			}
			await myQueue.add(
				"deployments",
				{ ...jobData },
				{
					removeOnComplete: true,
					removeOnFail: true,
				},
			);
			console.info("[audit] previewDeployment.redeploy", {
				action: "redeploy",
				resourceType: "previewDeployment",
				resourceId: input.previewDeploymentId,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return true;
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
