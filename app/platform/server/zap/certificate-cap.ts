// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// certificate-cap.ts — the native @zap-proto/web Certificate capability.
//
// Binary-ZAP replacement for the tRPC `certificateRouter`
// (server/api/routers/certificate.ts). Every method was
// `withPermission("certificate", <action>)` — an authenticated caller (session+
// user) whose body additionally enforces per-certificate org ownership. The mint
// boundary requires session+user (a null return rejects the WS upgrade with
// HTTP 401, mirroring protectedProcedure); the per-certificate ownership check is
// enforced INSIDE dispatch, verbatim from the original procedure bodies. Inputs
// ride the shared Args carrier, results the shared Result carrier;
// CertificateMethod ordinals are generated from certificate.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// certificate.<action>", …)`, mirroring how cluster-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	createCertificate,
	findCertificateById,
	IS_CLOUD,
	removeCertificateById,
	updateCertificate,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { eq } from "drizzle-orm";
import { certificates } from "@/server/db/schema";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { CertificateMethod } from "./schema/certificate_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface CertificateCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * certificateMintCap — bearer→ctx boundary. Mirrors `withPermission("certificate",
 * …)`'s authentication half (a `protectedProcedure` base): validates the upgrade
 * and requires session+user. Null → HTTP 401 before any socket opens. The
 * per-certificate org-ownership half runs inside dispatch (verbatim from the
 * bodies).
 */
export const certificateMintCap: MintCap<CertificateCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as CertificateCtx["userRole"];
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
 * certificateRootCap — dispatch each decoded Call by CertificateMethod ordinal to
 * the same service functions the tRPC procedure called. Inputs decode via the
 * shared Args carrier; results encode via the shared Result carrier. Errors map
 * to ZAP status codes (mirroring the tRPC error codes), never a thrown HTTP 500
 * leak.
 */
export function certificateRootCap(ctx: CertificateCtx): CallHandler {
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

async function dispatch(ctx: CertificateCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case CertificateMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: apiCreateCertificate input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			if (IS_CLOUD && !input.serverId) {
				throw new UnauthorizedError(
					"Please set a server to create a certificate",
				);
			}
			const cert = await createCertificate(input, ctx.organizationId);
			console.info("[audit] certificate.create", {
				action: "create",
				resourceType: "certificate",
				resourceId: cert.certificateId,
				resourceName: cert.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return cert;
		}

		case CertificateMethod.one: {
			const input = decodeArgs<{ certificateId: string }>(call.payload);
			const certificates = await findCertificateById(input.certificateId);
			if (certificates.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not allowed to access this certificate",
				);
			}
			return certificates;
		}

		case CertificateMethod.remove: {
			const input = decodeArgs<{ certificateId: string }>(call.payload);
			const certificates = await findCertificateById(input.certificateId);
			if (certificates.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not allowed to delete this certificate",
				);
			}
			console.info("[audit] certificate.delete", {
				action: "delete",
				resourceType: "certificate",
				resourceId: certificates.certificateId,
				resourceName: certificates.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			await removeCertificateById(input.certificateId);
			return true;
		}

		case CertificateMethod.all: {
			return await db.query.certificates.findMany({
				where: eq(certificates.organizationId, ctx.organizationId),
				with: {
					server: true,
				},
			});
		}

		case CertificateMethod.update: {
			const input = decodeArgs<{
				certificateId: string;
				name?: string;
				certificateData?: string;
				privateKey?: string;
			}>(call.payload);
			const certificate = await findCertificateById(input.certificateId);
			if (certificate.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not allowed to update this certificate",
				);
			}
			return await updateCertificate(input.certificateId, {
				name: input.name,
				certificateData: input.certificateData,
				privateKey: input.privateKey,
			});
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
