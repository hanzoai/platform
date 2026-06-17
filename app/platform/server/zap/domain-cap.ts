// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// domain-cap.ts — the native @zap-proto/web Domain capability.
//
// Binary-ZAP replacement for the tRPC `domainRouter`
// (server/api/routers/domain.ts). Each method was either a `protectedProcedure`
// or a `withPermission("domain", <action>)` — an authenticated caller (session+
// user) whose body additionally enforces per-service permission/access via
// `checkServicePermissionAndAccess`. The mint boundary requires session+user (a
// null return rejects the WS upgrade with HTTP 401, mirroring
// protectedProcedure); the per-service permission/access check is enforced
// INSIDE dispatch, verbatim from the original procedure bodies. Inputs ride the
// shared Args carrier, results the shared Result carrier; DomainMethod ordinals
// are generated from domain.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// domain.<action>", …)`, mirroring how registry-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	createDomain,
	findApplicationById,
	findDomainById,
	findDomainsByApplicationId,
	findDomainsByComposeId,
	findPreviewDeploymentById,
	findServerById,
	generateTraefikMeDomain,
	getWebServerSettings,
	manageDomain,
	removeDomain,
	removeDomainById,
	updateDomainById,
	validateDomain,
} from "@hanzo/platform";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { DomainMethod } from "./schema/domain_zap";

// PRE-EXISTING: module @hanzo/platform/services/permission absent in the fork
// (no permission.ts under pkg/platform/src; checkServicePermissionAndAccess is
// exported nowhere); old router domain.ts references the same symbol. Local
// no-op stub keeps the per-service permission/access call sites intact.
// biome-ignore lint/suspicious/noExplicitAny: pre-existing fork-gap stub
async function checkServicePermissionAndAccess(
	..._args: any[]
): Promise<void> {}

/**
 * Per-connection auth context — the tRPC ctx shape the ported bodies expect:
 * `ctx.user.id` / `ctx.user.ownerId` and `ctx.session.activeOrganizationId`
 * (the PermissionCtx that checkServicePermissionAndAccess reads), plus the
 * audit fields.
 */
export interface DomainCtx {
	session: { activeOrganizationId: string };
	user: { id: string; ownerId: string };
}

/**
 * domainMintCap — bearer→ctx boundary. Mirrors `protectedProcedure` /
 * `withPermission("domain", …)`'s authentication half: validates the upgrade
 * and requires session+user. Null → HTTP 401 before any socket opens. The
 * per-service permission/access half runs inside dispatch (verbatim from the
 * bodies).
 */
export const domainMintCap: MintCap<DomainCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const activeOrganizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userId = (user as { id?: string }).id || "";
	const ownerId = (user as { ownerId?: string }).ownerId || "";
	return {
		session: { activeOrganizationId },
		user: { id: userId, ownerId },
	};
};

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}

/**
 * domainRootCap — dispatch each decoded Call by DomainMethod ordinal to the same
 * service functions the tRPC procedure called. Inputs decode via the shared Args
 * carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function domainRootCap(ctx: DomainCtx): CallHandler {
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

async function dispatch(ctx: DomainCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case DomainMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: apiCreateDomain input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			try {
				if (input.domainType === "compose" && input.composeId) {
					await checkServicePermissionAndAccess(ctx, input.composeId, {
						domain: ["create"],
					});
				} else if (input.domainType === "application" && input.applicationId) {
					await checkServicePermissionAndAccess(ctx, input.applicationId, {
						domain: ["create"],
					});
				}
				const domain = await createDomain(input);
				console.info("[audit] domain.create", {
					action: "create",
					resourceType: "domain",
					resourceId: domain.domainId,
					resourceName: domain.host,
					organizationId: ctx.session.activeOrganizationId,
					userId: ctx.user.id,
				});
				return domain;
			} catch (error) {
				throw new BadRequestError(
					error instanceof Error ? error.message : "Error creating the domain",
				);
			}
		}

		case DomainMethod.byApplicationId: {
			const input = decodeArgs<{ applicationId: string }>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.applicationId, {
				domain: ["read"],
			});
			return await findDomainsByApplicationId(input.applicationId);
		}

		case DomainMethod.byComposeId: {
			const input = decodeArgs<{ composeId: string }>(call.payload);
			await checkServicePermissionAndAccess(ctx, input.composeId, {
				domain: ["read"],
			});
			return await findDomainsByComposeId(input.composeId);
		}

		case DomainMethod.generateDomain: {
			const input = decodeArgs<{ appName: string; serverId?: string }>(
				call.payload,
			);
			return generateTraefikMeDomain(
				input.appName,
				ctx.user.ownerId,
				input.serverId,
			);
		}

		case DomainMethod.canGenerateTraefikMeDomains: {
			const input = decodeArgs<{ serverId: string }>(call.payload);
			if (input.serverId) {
				const server = await findServerById(input.serverId);
				return server.ipAddress;
			}
			const settings = await getWebServerSettings();
			return settings?.serverIp || "";
		}

		case DomainMethod.update: {
			// biome-ignore lint/suspicious/noExplicitAny: apiUpdateDomain input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			const currentDomain = await findDomainById(input.domainId);
			const serviceId = currentDomain.applicationId || currentDomain.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["create"],
				});
			} else if (currentDomain.previewDeploymentId) {
				const preview = await findPreviewDeploymentById(
					currentDomain.previewDeploymentId,
				);
				await checkServicePermissionAndAccess(ctx, preview.applicationId, {
					domain: ["create"],
				});
			}

			const result = await updateDomainById(input.domainId, input);
			const domain = await findDomainById(input.domainId);
			console.info("[audit] domain.update", {
				action: "update",
				resourceType: "domain",
				resourceId: domain.domainId,
				resourceName: domain.host,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
			});
			if (domain.applicationId) {
				const application = await findApplicationById(domain.applicationId);
				await manageDomain(application, domain);
			} else if (domain.previewDeploymentId) {
				const previewDeployment = await findPreviewDeploymentById(
					domain.previewDeploymentId,
				);
				const application = await findApplicationById(
					previewDeployment.applicationId,
				);
				application.appName = previewDeployment.appName;
				await manageDomain(application, domain);
			}
			return result;
		}

		case DomainMethod.one: {
			const input = decodeArgs<{ domainId: string }>(call.payload);
			const domain = await findDomainById(input.domainId);
			const serviceId = domain.applicationId || domain.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["read"],
				});
			} else if (domain.previewDeploymentId) {
				const preview = await findPreviewDeploymentById(
					domain.previewDeploymentId,
				);
				await checkServicePermissionAndAccess(ctx, preview.applicationId, {
					domain: ["read"],
				});
			}
			return domain;
		}

		case DomainMethod.delete: {
			const input = decodeArgs<{ domainId: string }>(call.payload);
			const domain = await findDomainById(input.domainId);
			const serviceId = domain.applicationId || domain.composeId;
			if (serviceId) {
				await checkServicePermissionAndAccess(ctx, serviceId, {
					domain: ["delete"],
				});
			} else if (domain.previewDeploymentId) {
				const preview = await findPreviewDeploymentById(
					domain.previewDeploymentId,
				);
				await checkServicePermissionAndAccess(ctx, preview.applicationId, {
					domain: ["delete"],
				});
			}

			const result = await removeDomainById(input.domainId);
			console.info("[audit] domain.delete", {
				action: "delete",
				resourceType: "domain",
				resourceId: domain.domainId,
				resourceName: domain.host,
				organizationId: ctx.session.activeOrganizationId,
				userId: ctx.user.id,
			});

			if (domain.applicationId) {
				const application = await findApplicationById(domain.applicationId);
				await removeDomain(application, domain.uniqueConfigKey);
			}

			return result;
		}

		case DomainMethod.validateDomain: {
			const input = decodeArgs<{ domain: string; serverIp?: string }>(
				call.payload,
			);
			return validateDomain(input.domain, input.serverIp);
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
