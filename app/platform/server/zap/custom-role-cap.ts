// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// custom-role-cap.ts — the native @zap-proto/web CustomRole capability
// (ENTERPRISE).
//
// Binary-ZAP replacement for the tRPC `customRoleRouter`
// (server/api/routers/enterprise/custom-role.ts). The `all`, `membersByRole`,
// and `getStatements` methods were `protectedProcedure` (authenticated only);
// `create`, `update`, and `remove` were `enterpriseProcedure` (= adminProcedure,
// owner|admin only). The mint boundary requires session+user (a null return
// rejects the WS upgrade with HTTP 401, mirroring protectedProcedure); the
// owner|admin gate is enforced per-call in dispatch via requireAdmin(ctx),
// mirroring ai-cap.ts. Inputs ride the shared Args carrier, results the shared
// Result carrier; CustomRoleMethod ordinals are generated from custom-role.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// customRole.<action>", …)`, mirroring how registry-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import { db } from "@hanzo/platform/db";
// PRE-EXISTING: the Hanzo fork strips the enterprise RBAC layer — the
// `organizationRole` table and `@hanzo/platform/lib/access-control`
// (`statements`) do not exist in the fork's schema/lib. The custom-role
// feature is unavailable here; these imports resolve to nothing and every
// reference below (organizationRole queries, statements) is a fork gap, not
// a regression introduced by this cap.
import { member, organizationRole, user } from "@hanzo/platform/db/schema";
import { validateRequest } from "@hanzo/platform/lib/auth";
import { statements } from "@hanzo/platform/lib/access-control";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { and, count, eq } from "drizzle-orm";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { CustomRoleMethod } from "./schema/custom-role_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface CustomRoleCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * customRoleMintCap — bearer→ctx boundary. Mirrors the router's authentication
 * half (a `protectedProcedure` base): validates the upgrade and requires
 * session+user. Null → HTTP 401 before any socket opens. The owner|admin half
 * (`enterpriseProcedure` methods) runs per-call in dispatch via requireAdmin.
 */
export const customRoleMintCap: MintCap<CustomRoleCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user: u } = await validateRequest(req);
	if (!session || !u) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((u as { role?: string }).role ??
		"member") as CustomRoleCtx["userRole"];
	const userId = (u as { id?: string }).id || "";
	const email = (u as { email?: string }).email || "";
	return { organizationId, userRole, userId, email };
};

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}
/**
 * Typed conflict failure. The tRPC source threw `CONFLICT` (HTTP 409); the ZAP
 * Status enum has no Conflict ordinal, so this collapses to Status.BadRequest
 * (the nearest available client-error status) while preserving the verbatim
 * "Role … already exists" message.
 */
class ConflictError extends Error {}

/** Admin gate — mirrors `enterpriseProcedure` (= adminProcedure, owner|admin only). */
function requireAdmin(ctx: CustomRoleCtx): void {
	if (ctx.userRole !== "owner" && ctx.userRole !== "admin") {
		throw new UnauthorizedError("admin role required");
	}
}

/**
 * customRoleRootCap — dispatch each decoded Call by CustomRoleMethod ordinal to
 * the same queries the tRPC procedure ran. Inputs decode via the shared Args
 * carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function customRoleRootCap(ctx: CustomRoleCtx): CallHandler {
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
						: err instanceof ConflictError || err instanceof BadRequestError
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

async function dispatch(ctx: CustomRoleCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case CustomRoleMethod.all: {
			const [roles, memberCounts] = await Promise.all([
				db.query.organizationRole.findMany({
					where: eq(organizationRole.organizationId, ctx.organizationId),
				}),
				db
					.select({ role: member.role, count: count() })
					.from(member)
					.where(eq(member.organizationId, ctx.organizationId))
					.groupBy(member.role),
			]);

			const memberCountByRole = new Map(
				memberCounts.map((r: { role: string; count: number }) => [
					r.role,
					r.count,
				]),
			);

			const roleMap = new Map<
				string,
				{
					role: string;
					permissions: Record<string, string[]>;
					createdAt: Date;
					ids: string[];
					memberCount: number;
				}
			>();

			for (const entry of roles) {
				const existing = roleMap.get(entry.role);
				const parsed = JSON.parse(entry.permission) as Record<string, string[]>;

				if (existing) {
					for (const [resource, actions] of Object.entries(parsed)) {
						existing.permissions[resource] = [
							...new Set([...(existing.permissions[resource] ?? []), ...actions]),
						];
					}
					existing.ids.push(entry.id);
				} else {
					roleMap.set(entry.role, {
						role: entry.role,
						permissions: parsed,
						createdAt: entry.createdAt,
						ids: [entry.id],
						memberCount: memberCountByRole.get(entry.role) ?? 0,
					});
				}
			}

			return Array.from(roleMap.values());
		}

		case CustomRoleMethod.create: {
			requireAdmin(ctx);
			const input = decodeArgs<{
				roleName: string;
				permissions: Record<string, string[]>;
			}>(call.payload);
			const existingRoles = await db.query.organizationRole.findMany({
				where: eq(organizationRole.organizationId, ctx.organizationId),
			});

			const uniqueRoleNames = new Set(
				// PRE-EXISTING: existingRoles is `any` because organizationRole is
				// absent from the fork schema; annotate the param to keep noImplicitAny
				// quiet without inventing a type for a table that does not exist.
				existingRoles.map((r: { role: string }) => r.role),
			);

			if (uniqueRoleNames.size >= 10) {
				throw new BadRequestError(
					"Maximum of 10 custom roles per organization reached",
				);
			}

			if (uniqueRoleNames.has(input.roleName)) {
				throw new ConflictError(`Role "${input.roleName}" already exists`);
			}

			validatePermissions(input.permissions);

			const [created] = await db
				.insert(organizationRole)
				.values({
					organizationId: ctx.organizationId,
					role: input.roleName,
					permission: JSON.stringify(input.permissions),
				})
				.returning();

			console.info("[audit] customRole.create", {
				action: "create",
				resourceType: "customRole",
				resourceName: input.roleName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return created;
		}

		case CustomRoleMethod.update: {
			requireAdmin(ctx);
			const input = decodeArgs<{
				roleName: string;
				newRoleName?: string;
				permissions: Record<string, string[]>;
			}>(call.payload);
			if (["owner", "admin", "member"].includes(input.roleName)) {
				throw new BadRequestError("Cannot modify built-in roles");
			}

			const effectiveRoleName = input.newRoleName ?? input.roleName;

			if (input.newRoleName && input.newRoleName !== input.roleName) {
				const existing = await db.query.organizationRole.findFirst({
					where: and(
						eq(organizationRole.organizationId, ctx.organizationId),
						eq(organizationRole.role, input.newRoleName),
					),
				});
				if (existing) {
					throw new ConflictError(
						`Role "${input.newRoleName}" already exists`,
					);
				}

				await db
					.update(member)
					.set({ role: input.newRoleName })
					.where(
						and(
							eq(member.organizationId, ctx.organizationId),
							eq(member.role, input.roleName),
						),
					);
			}

			validatePermissions(input.permissions);

			const [updated] = await db
				.update(organizationRole)
				.set({
					role: effectiveRoleName,
					permission: JSON.stringify(input.permissions),
				})
				.where(
					and(
						eq(organizationRole.organizationId, ctx.organizationId),
						eq(organizationRole.role, input.roleName),
					),
				)
				.returning();

			console.info("[audit] customRole.update", {
				action: "update",
				resourceType: "customRole",
				resourceName: effectiveRoleName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return updated;
		}

		case CustomRoleMethod.remove: {
			requireAdmin(ctx);
			const input = decodeArgs<{ roleName: string }>(call.payload);
			if (["owner", "admin", "member"].includes(input.roleName)) {
				throw new BadRequestError("Cannot delete built-in roles");
			}

			const assignedMembers = await db.query.member.findMany({
				where: and(
					eq(member.organizationId, ctx.organizationId),
					eq(member.role, input.roleName),
				),
			});

			if (assignedMembers.length > 0) {
				throw new BadRequestError(
					`Cannot delete role "${input.roleName}": ${assignedMembers.length} member(s) are currently assigned to it. Reassign them first.`,
				);
			}

			const deleted = await db
				.delete(organizationRole)
				.where(
					and(
						eq(organizationRole.organizationId, ctx.organizationId),
						eq(organizationRole.role, input.roleName),
					),
				)
				.returning();

			if (deleted.length === 0) {
				throw new NotFoundError(`Role "${input.roleName}" not found`);
			}

			console.info("[audit] customRole.delete", {
				action: "delete",
				resourceType: "customRole",
				resourceName: input.roleName,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
				userEmail: ctx.email,
			});
			return { deleted: deleted.length };
		}

		case CustomRoleMethod.membersByRole: {
			const input = decodeArgs<{ roleName: string }>(call.payload);
			const members = await db
				.select({
					id: member.id,
					userId: member.userId,
					email: user.email,
					firstName: user.firstName,
					lastName: user.lastName,
				})
				.from(member)
				.innerJoin(user, eq(member.userId, user.id))
				.where(
					and(
						eq(member.organizationId, ctx.organizationId),
						eq(member.role, input.roleName),
					),
				);
			return members;
		}

		case CustomRoleMethod.getStatements: {
			return statements;
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}

const INTERNAL_RESOURCES = ["organization", "invitation", "team", "ac"];

function validatePermissions(permissions: Record<string, string[]>) {
	for (const [resource, actions] of Object.entries(permissions)) {
		if (INTERNAL_RESOURCES.includes(resource)) {
			throw new BadRequestError(
				`Resource "${resource}" is managed internally and cannot be assigned to custom roles`,
			);
		}

		if (!(resource in statements)) {
			throw new BadRequestError(`Unknown resource: ${resource}`);
		}

		const validActions = statements[resource as keyof typeof statements];
		for (const action of actions) {
			if (!validActions.includes(action as never)) {
				throw new BadRequestError(
					`Invalid action "${action}" for resource "${resource}". Valid actions: ${validActions.join(", ")}`,
				);
			}
		}
	}
}
