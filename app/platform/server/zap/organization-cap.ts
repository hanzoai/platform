// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// organization-cap.ts — the native @zap-proto/web Organization capability.
//
// Binary-ZAP replacement for the tRPC `organizationRouter`
// (server/api/routers/organization.ts):
//   - organizationMintCap: bearer→ctx boundary at the WS upgrade. Mirrors the
//                          tRPC procedures' base gating: a session+user is
//                          required (replaces `protectedProcedure`); a null
//                          return rejects the upgrade with HTTP 401. The
//                          `allInvitations`/`removeInvitation` methods were
//                          `adminProcedure` — that gate (owner|admin) is enforced
//                          per-call in dispatch via requireAdmin(ctx).
//   - organizationRootCap: rootCap(ctx) → CallHandler. Dispatches each decoded
//                          ZAP Call by its method ordinal (OrganizationMethod,
//                          generated from organization.zap) to the same DB
//                          operations the tRPC procedure ran, with the same
//                          owner/membership checks ported verbatim.
//
// Inputs ride the shared Args carrier (decodeArgs); results the shared Result
// carrier (encodeResult). The OrganizationMethod ordinal table is generated from
// organization.zap.

import type { IncomingMessage } from "node:http";
import { IS_CLOUD } from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { invitation, member, organization } from "@hanzo/platform/db/schema";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { and, desc, eq, exists } from "drizzle-orm";
import { nanoid } from "nanoid";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { OrganizationMethod } from "./schema/organization_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface OrganizationCtx {
	session: { activeOrganizationId: string };
	user: { id: string; role: "owner" | "member" | "admin" };
}

/** Typed errors → ZAP status codes (mirror the tRPC error codes). */
class BadRequestError extends Error {}
class ForbiddenError extends Error {}
class NotFoundError extends Error {}
class InternalError extends Error {}

/** Admin gate — mirrors `adminProcedure` (owner|admin only). */
function requireAdmin(ctx: OrganizationCtx): void {
	if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
		throw new ForbiddenError("admin role required");
	}
}

/**
 * organizationMintCap — bearer→ctx boundary. Requires a session+user (mirrors
 * `protectedProcedure`); null → HTTP 401 before any socket opens. Admin-only
 * methods are gated per-call in dispatch.
 */
export const organizationMintCap: MintCap<OrganizationCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const activeOrganizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const role = ((user as { role?: string }).role ??
		"member") as OrganizationCtx["user"]["role"];
	return {
		session: { activeOrganizationId },
		user: { id: (user as { id: string }).id, role },
	};
};

/**
 * organizationRootCap — the connection's dispatch root. For each decoded Call,
 * decode the input via the shared Args carrier, run the matching DB operation
 * (the very same one the tRPC procedure ran), and encode the result. Errors map
 * to ZAP status codes, never a thrown HTTP 500 leak.
 */
export function organizationRootCap(ctx: OrganizationCtx): CallHandler {
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

async function dispatch(ctx: OrganizationCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case OrganizationMethod.create: {
			const input = decodeArgs<{ name: string; logo?: string }>(call.payload);
			if (ctx.user.role !== "owner" && !IS_CLOUD) {
				throw new ForbiddenError(
					"Only the organization owner can create an organization",
				);
			}
			const result = await db
				.insert(organization)
				.values({
					...input,
					slug: nanoid(),
					createdAt: new Date(),
					ownerId: ctx.user.id,
				} as any)
				.returning()
				.then((res) => res[0]);

			console.log("result", result);

			if (!result) {
				throw new InternalError("Failed to create organization");
			}

			await db.insert(member).values({
				organizationId: result.id,
				role: "owner",
				createdAt: new Date(),
				userId: ctx.user.id,
			});
			return result;
		}

		case OrganizationMethod.all: {
			const memberResult = await db.query.organization.findMany({
				where: (organization) =>
					exists(
						db
							.select()
							.from(member)
							.where(
								and(
									eq(member.organizationId, organization.id),
									eq(member.userId, ctx.user.id),
								),
							),
					),
			});
			return memberResult;
		}

		case OrganizationMethod.one: {
			const input = decodeArgs<{ organizationId: string }>(call.payload);
			// Verify the caller is a member of the requested organization
			const memberResult = await db.query.member.findFirst({
				where: and(
					eq(member.userId, ctx.user.id),
					eq(member.organizationId, input.organizationId),
				),
			});
			if (!memberResult) {
				throw new ForbiddenError(
					"You are not a member of this organization",
				);
			}
			return await db.query.organization.findFirst({
				where: eq(organization.id, input.organizationId),
			});
		}

		case OrganizationMethod.update: {
			const input = decodeArgs<{
				organizationId: string;
				name: string;
				logo?: string;
			}>(call.payload);
			// Verify the caller owns or is a member of this specific org
			const org = await db.query.organization.findFirst({
				where: eq(organization.id, input.organizationId),
			});
			if (!org) {
				throw new NotFoundError("Organization not found");
			}
			if (org.ownerId !== ctx.user.id) {
				throw new ForbiddenError("Only the organization owner can update it");
			}
			const result = await db
				.update(organization)
				.set({
					name: input.name,
					logo: input.logo,
				} as any)
				.where(eq(organization.id, input.organizationId))
				.returning();
			return result[0];
		}

		case OrganizationMethod.delete: {
			const input = decodeArgs<{ organizationId: string }>(call.payload);
			if (ctx.user.role !== "owner" && !IS_CLOUD) {
				throw new ForbiddenError("Only the organization owner can delete it");
			}
			const org = await db.query.organization.findFirst({
				where: eq(organization.id, input.organizationId),
			});

			if (!org) {
				throw new NotFoundError("Organization not found");
			}

			if (org.ownerId !== ctx.user.id) {
				throw new ForbiddenError("Only the organization owner can delete it");
			}

			const ownerOrgs = await db.query.organization.findMany({
				where: eq(organization.ownerId, ctx.user.id),
			});

			if (ownerOrgs.length <= 1) {
				throw new ForbiddenError(
					"You must maintain at least one organization where you are the owner",
				);
			}

			const result = await db
				.delete(organization)
				.where(eq(organization.id, input.organizationId));

			return result;
		}

		case OrganizationMethod.allInvitations: {
			requireAdmin(ctx);
			return await db.query.invitation.findMany({
				where: eq(invitation.organizationId, ctx.session.activeOrganizationId),
				orderBy: [desc(invitation.status), desc(invitation.expiresAt)],
			});
		}

		case OrganizationMethod.removeInvitation: {
			requireAdmin(ctx);
			const input = decodeArgs<{ invitationId: string }>(call.payload);
			const invitationResult = await db.query.invitation.findFirst({
				where: eq(invitation.id, input.invitationId),
			});

			if (!invitationResult) {
				throw new NotFoundError("Invitation not found");
			}

			if (
				invitationResult?.organizationId !== ctx.session.activeOrganizationId
			) {
				throw new ForbiddenError(
					"You are not allowed to remove this invitation",
				);
			}

			return await db
				.delete(invitation)
				.where(eq(invitation.id, input.invitationId));
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
