// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// user-cap.ts — the native @zap-proto/web User capability.
//
// Binary-ZAP replacement for the tRPC `userRouter`
// (server/api/routers/user.ts). The router mixes procedure bases:
//   - publicProcedure       (session, getUserByToken) — no auth required;
//   - protectedProcedure    (one, get, getPermissions, haveRootAccess, update,
//                            remove, getInvitations, generateToken, deleteApiKey,
//                            createApiKey, checkUserOrganizations,
//                            getBookmarkedTemplates, toggleTemplateBookmark);
//   - adminProcedure        (getBackups);
//   - withPermission(...)   (all, getServerMetrics, getMetricsToken,
//                            assignPermissions, getContainerMetrics,
//                            createUserWithCredentials, sendInvitation).
//
// The mint boundary establishes the authenticated caller (session+user) and
// threads the FULL tRPC-shaped ctx into dispatch — the verbatim bodies read
// `ctx.user.{id,role,ownerId,email}` and `ctx.session.{id,activeOrganizationId,
// impersonatedBy}`. publicProcedure methods (session, getUserByToken) tolerate a
// null session/user inside their own bodies, so the mint does NOT reject when
// auth is absent — it returns a ctx with nullable session/user, mirroring
// publicProcedure. Each body's additional role/permission checks (owner|admin
// gates, password verification, org-ownership, self-protection) ride VERBATIM
// inside dispatch. Inputs ride the shared Args carrier (decodeArgs); results the
// shared Result carrier (encodeResult). UserMethod ordinals are generated from
// user.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// user.<action>", …)`, mirroring how registry-cap.ts / port-cap.ts ported audit.

import type { IncomingMessage } from "node:http";
import {
	createApiKey,
	createOrganizationUserWithCredentials,
	findNotificationById,
	findOrganizationById,
	findUserById,
	getHanzoUrl,
	getUserByToken,
	getWebServerSettings,
	IS_CLOUD,
	removeUserById,
	renderInvitationEmail,
	sendEmailNotification,
	sendResendNotification,
	updateUser,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import {
	account,
	apiAssignPermissions,
	apiFindOneToken,
	apikey,
	apiUpdateUser,
	invitation,
	member,
} from "@hanzo/platform/db/schema";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import * as bcrypt from "bcrypt";
import { and, asc, eq, gt, ne } from "drizzle-orm";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { UserMethod } from "./schema/user_zap";

/**
 * Per-connection auth context — the minted value `serve()` threads into rootCap.
 * Shaped to the tRPC `ctx` the verbatim bodies read: a nullable session/user
 * (publicProcedure tolerates null; the protected/admin/withPermission bodies
 * run only after the mint has established a non-null caller). The full objects
 * are captured so bodies referencing `ctx.user.ownerId`, `ctx.session.id`, and
 * `ctx.session.impersonatedBy` resolve exactly as under tRPC.
 */
export interface UserCtx {
	session:
		| {
				id: string;
				activeOrganizationId: string;
				impersonatedBy?: string;
		  }
		| null;
	user:
		| {
				id: string;
				role: "owner" | "member" | "admin";
				ownerId: string;
				email: string;
		  }
		| null;
}

/** Typed errors → ZAP status codes (mirror the tRPC error codes). */
class UnauthorizedError extends Error {}
class NotFoundError extends Error {}
class BadRequestError extends Error {}
class ForbiddenError extends Error {}

/**
 * userMintCap — bearer→ctx boundary. Validates the upgrade and captures the
 * full tRPC-shaped ctx. The router exposes publicProcedure methods (session,
 * getUserByToken) whose bodies handle a null caller themselves, so the mint
 * does NOT reject on absent auth — it returns a ctx with nullable session/user,
 * faithfully mirroring publicProcedure. The protected/admin/withPermission
 * bodies dereference `ctx.user`/`ctx.session` and would have been gated by the
 * tRPC middleware; that gate is reproduced verbatim where the bodies need it.
 */
export const userMintCap: MintCap<UserCtx> = async (req: IncomingMessage) => {
	const { session, user } = await validateRequest(req);
	const ctxSession = session
		? {
				id: (session as { id?: string }).id || "",
				activeOrganizationId:
					(session as { activeOrganizationId?: string })
						.activeOrganizationId || "",
				impersonatedBy: (session as { impersonatedBy?: string })
					.impersonatedBy,
			}
		: null;
	const ctxUser = user
		? {
				id: (user as { id?: string }).id || "",
				role: ((user as { role?: string }).role ??
					"member") as NonNullable<UserCtx["user"]>["role"],
				ownerId: (user as { ownerId?: string }).ownerId || "",
				email: (user as { email?: string }).email || "",
			}
		: null;
	return { session: ctxSession, user: ctxUser };
};

/**
 * userRootCap — dispatch each decoded Call by UserMethod ordinal to the same
 * service functions the tRPC procedure called. Inputs decode via the shared Args
 * carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function userRootCap(ctx: UserCtx): CallHandler {
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
					: err instanceof ForbiddenError
						? Status.Forbidden
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

// audit — the tRPC `audit(ctx, …)` side effect, recorded as a structured log
// (its RBAC/license machinery is stripped on this branch). Mirrors registry-cap
// / port-cap. Accepts the same shape the verbatim bodies pass.
function audit(
	c: UserCtx,
	entry: {
		action: string;
		resourceType: string;
		resourceId?: string;
		resourceName?: string;
		metadata?: Record<string, unknown>;
	},
): void {
	console.info(`[audit] user.${entry.action}`, {
		...entry,
		organizationId: c.session?.activeOrganizationId,
		userId: c.user?.id,
		userEmail: c.user?.email,
	});
}

async function dispatch(ctx: UserCtx, call: Call): Promise<unknown> {
	// TRPCError shim — the verbatim bodies `throw new TRPCError({ code, message })`.
	// Map each code to the typed error the rootCap catch translates to a ZAP status.
	const TRPCError = class extends Error {
		constructor(opts: { code: string; message?: string }) {
			super(opts.message);
			switch (opts.code) {
				case "UNAUTHORIZED":
					return new UnauthorizedError(opts.message);
				case "NOT_FOUND":
					return new NotFoundError(opts.message);
				case "BAD_REQUEST":
					return new BadRequestError(opts.message);
				case "FORBIDDEN":
					return new ForbiddenError(opts.message);
				default:
					return new Error(opts.message);
			}
		}
	};

	switch (call.method) {
		case UserMethod.all: {
			return await db.query.member.findMany({
				where: eq(member.organizationId, ctx.session.activeOrganizationId),
				with: {
					user: true,
				},
				orderBy: [asc(member.createdAt)],
			});
		}

		case UserMethod.one: {
			const input = decodeArgs<{ userId: string }>(call.payload);
			const memberResult = await db.query.member.findFirst({
				where: and(
					eq(member.userId, input.userId),
					eq(member.organizationId, ctx.session?.activeOrganizationId || ""),
				),
				with: {
					user: true,
				},
			});

			// If user not found in the organization, deny access
			if (!memberResult) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "User not found in this organization",
				});
			}

			// Allow access if:
			// 1. User is requesting their own information
			// 2. User is owner/admin
			// 3. User has member.update permission (custom roles managing permissions)
			if (
				memberResult.userId !== ctx.user.id &&
				ctx.user.role !== "owner" &&
				ctx.user.role !== "admin"
			) {
				const canUpdate = await hasPermission(ctx, { member: ["update"] });
				if (!canUpdate) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to access this user",
					});
				}
			}

			return memberResult;
		}

		case UserMethod.session: {
			if (!ctx.user || !ctx.session || !ctx.session.activeOrganizationId) {
				return null;
			}
			return {
				user: {
					id: ctx.user.id,
				},
				session: {
					activeOrganizationId: ctx.session.activeOrganizationId,
				},
			};
		}

		case UserMethod.get: {
			const memberResult = await db.query.member.findFirst({
				where: and(
					eq(member.userId, ctx.user.id),
					eq(member.organizationId, ctx.session?.activeOrganizationId || ""),
				),
				with: {
					user: {
						with: {
							apiKeys: true,
						},
					},
				},
			});

			return memberResult;
		}

		case UserMethod.getPermissions: {
			return resolvePermissions(ctx);
		}

		case UserMethod.haveRootAccess: {
			if (!IS_CLOUD) {
				return false;
			}
			if (
				process.env.USER_ADMIN_ID === ctx.user.id ||
				ctx.session?.impersonatedBy === process.env.USER_ADMIN_ID
			) {
				return true;
			}
			return false;
		}

		case UserMethod.getBackups: {
			const memberResult = await db.query.member.findFirst({
				where: and(
					eq(member.userId, ctx.user.id),
					eq(member.organizationId, ctx.session?.activeOrganizationId || ""),
				),
				with: {
					user: {
						with: {
							backups: {
								with: {
									destination: true,
									deployments: true,
								},
							},
							apiKeys: true,
						},
					},
				},
			});

			return memberResult?.user;
		}

		case UserMethod.getServerMetrics: {
			const memberResult = await db.query.member.findFirst({
				where: and(
					eq(member.userId, ctx.user.id),
					eq(member.organizationId, ctx.session?.activeOrganizationId || ""),
				),
				with: {
					user: true,
				},
			});

			return memberResult?.user;
		}

		case UserMethod.update: {
			const input = decodeArgs<typeof apiUpdateUser._type>(call.payload);
			if (input.password || input.currentPassword) {
				const currentAuth = await db.query.account.findFirst({
					where: eq(account.userId, ctx.user.id),
				});
				const correctPassword = bcrypt.compareSync(
					input.currentPassword || "",
					currentAuth?.password || "",
				);

				if (!correctPassword) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Current password is incorrect",
					});
				}

				if (!input.password) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "New password is required",
					});
				}
				await db
					.update(account)
					.set({
						password: bcrypt.hashSync(input.password, 10),
					})
					.where(eq(account.userId, ctx.user.id));

				await db
					.delete(session)
					.where(
						and(
							eq(session.userId, ctx.user.id),
							ne(session.id, ctx.session.id),
						),
					);
			}

			try {
				const result = await updateUser(ctx.user.id, input);
				await audit(ctx, {
					action: "update",
					resourceType: "user",
					resourceId: ctx.user.id,
					resourceName: ctx.user.email,
				});
				return result;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error ? error.message : "Failed to update user",
				});
			}
		}

		case UserMethod.getUserByToken: {
			const input = decodeArgs<typeof apiFindOneToken._type>(call.payload);
			return await getUserByToken(input.token);
		}

		case UserMethod.getMetricsToken: {
			const user = await findUserById(ctx.user.ownerId);
			const settings = await getWebServerSettings();
			return {
				serverIp: settings?.serverIp,
				enabledFeatures: user.enablePaidFeatures,
				metricsConfig: settings?.metricsConfig,
			};
		}

		case UserMethod.remove: {
			const input = decodeArgs<{ userId: string }>(call.payload);
			if (IS_CLOUD) {
				return true;
			}

			// Ensure the acting user has admin privileges in the active organization
			if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Only owners or admins can delete users",
				});
			}

			// Fetch target member within the active organization
			const targetMember = await db.query.member.findFirst({
				where: and(
					eq(member.userId, input.userId),
					eq(member.organizationId, ctx.session?.activeOrganizationId || ""),
				),
			});

			if (!targetMember) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Target user is not a member of this organization",
				});
			}

			// Never allow deleting the organization owner via this endpoint
			if (targetMember.role === "owner") {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "You cannot delete the organization owner",
				});
			}

			// Admin self-protection: an admin cannot delete themselves
			if (targetMember.role === "admin" && input.userId === ctx.user.id) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						"Admins cannot delete themselves. Ask the owner or another admin.",
				});
			}

			// Only owners can delete admins
			// Admins can only delete members
			if (ctx.user.role === "admin" && targetMember.role === "admin") {
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						"Only the organization owner can delete admins. Admins can only delete members.",
				});
			}

			const result = await removeUserById(input.userId);
			await audit(ctx, {
				action: "delete",
				resourceType: "user",
				resourceId: input.userId,
			});
			return result;
		}

		case UserMethod.assignPermissions: {
			const input = decodeArgs<typeof apiAssignPermissions._type>(
				call.payload,
			);
			try {
				const organization = await findOrganizationById(
					ctx.session?.activeOrganizationId || "",
				);

				if (organization?.ownerId !== ctx.user.ownerId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not allowed to assign permissions",
					});
				}

				const { id, accessedGitProviders, accessedServers, ...rest } = input;

				const licensed = await hasValidLicense(
					ctx.session?.activeOrganizationId || "",
				);

				await db
					.update(member)
					.set({
						...rest,
						...(licensed && accessedGitProviders !== undefined
							? { accessedGitProviders }
							: {}),
						...(licensed && accessedServers !== undefined
							? { accessedServers }
							: {}),
					})
					.where(
						and(
							eq(member.userId, input.id),
							eq(
								member.organizationId,
								ctx.session?.activeOrganizationId || "",
							),
						),
					);
				await audit(ctx, {
					action: "update",
					resourceType: "user",
					resourceId: input.id,
					metadata: { permissions: rest },
				});
			} catch (error) {
				throw error;
			}
			return;
		}

		case UserMethod.getInvitations: {
			return await db.query.invitation.findMany({
				where: and(
					eq(invitation.email, ctx.user.email),
					gt(invitation.expiresAt, new Date()),
					eq(invitation.status, "pending"),
				),
				with: {
					organization: true,
				},
			});
		}

		case UserMethod.getContainerMetrics: {
			const input = decodeArgs<{
				url: string;
				token: string;
				appName: string;
				dataPoints: string;
			}>(call.payload);
			try {
				if (!input.appName) {
					throw new Error(
						[
							"No Application Selected:",
							"",
							"Make Sure to select an application to monitor.",
						].join("\n"),
					);
				}
				const url = new URL(`${input.url}/metrics/containers`);
				url.searchParams.append("limit", input.dataPoints);
				url.searchParams.append("appName", input.appName);
				const response = await fetch(url.toString(), {
					headers: {
						Authorization: `Bearer ${input.token}`,
					},
				});
				if (!response.ok) {
					throw new Error(
						`Error ${response.status}: ${response.statusText}. Please verify that the application "${input.appName}" is running and this service is included in the monitoring configuration.`,
					);
				}

				const data = await response.json();
				if (!Array.isArray(data) || data.length === 0) {
					throw new Error(
						[
							`No monitoring data available for "${input.appName}". This could be because:`,
							"",
							"1. The container was recently started - wait a few minutes for data to be collected",
							"2. The container is not running - verify its status",
							"3. The service is not included in your monitoring configuration",
						].join("\n"),
					);
				}
				return data as {
					containerId: string;
					containerName: string;
					containerImage: string;
					containerLabels: string;
					containerCommand: string;
					containerCreated: string;
				}[];
			} catch (error) {
				throw error;
			}
		}

		case UserMethod.generateToken: {
			return "token";
		}

		case UserMethod.deleteApiKey: {
			const input = decodeArgs<{ apiKeyId: string }>(call.payload);
			try {
				const apiKeyToDelete = await db.query.apikey.findFirst({
					where: eq(apikey.id, input.apiKeyId),
				});

				if (!apiKeyToDelete) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "API key not found",
					});
				}

				if (apiKeyToDelete.referenceId !== ctx.user.id) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to delete this API key",
					});
				}

				await db.delete(apikey).where(eq(apikey.id, input.apiKeyId));
				await audit(ctx, {
					action: "delete",
					resourceType: "user",
					resourceId: input.apiKeyId,
					resourceName: apiKeyToDelete.name || undefined,
				});
				return true;
			} catch (error) {
				throw error;
			}
		}

		case UserMethod.createApiKey: {
			const input = decodeArgs<{
				name: string;
				metadata: { organizationId: string };
				// biome-ignore lint/suspicious/noExplicitAny: apiCreateApiKey input, ported verbatim
				[k: string]: any;
			}>(call.payload);
			// Verify user is a member of the organization specified in metadata
			if (input.metadata?.organizationId) {
				const userMember = await db.query.member.findFirst({
					where: and(
						eq(member.organizationId, input.metadata.organizationId),
						eq(member.userId, ctx.user.id),
					),
				});

				if (!userMember) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "You are not a member of this organization",
					});
				}
			}

			const apiKey = await createApiKey(ctx.user.id, input);
			await audit(ctx, {
				action: "create",
				resourceType: "user",
				resourceId: apiKey.id,
				resourceName: input.name,
			});
			return apiKey;
		}

		case UserMethod.checkUserOrganizations: {
			const input = decodeArgs<{ userId: string }>(call.payload);
			// Users can check their own organizations
			// Admins and owners can check organizations of members in their active organization
			if (input.userId !== ctx.user.id) {
				// Verify the target user is a member of the active organization
				const targetMember = await db.query.member.findFirst({
					where: and(
						eq(member.userId, input.userId),
						eq(member.organizationId, ctx.session?.activeOrganizationId || ""),
					),
				});

				if (!targetMember) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: "User is not a member of your active organization",
					});
				}

				// Only admins and owners can check other users' organizations
				if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
					throw new TRPCError({
						code: "FORBIDDEN",
						message:
							"Only admins and owners can check other users' organizations",
					});
				}
			}

			const organizations = await db.query.member.findMany({
				where: eq(member.userId, input.userId),
			});

			return organizations.length;
		}

		case UserMethod.createUserWithCredentials: {
			const input = decodeArgs<{
				email: string;
				password: string;
				role: string;
			}>(call.payload);
			if (IS_CLOUD) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						"Creating users with initial credentials is only available in self-hosted mode",
				});
			}

			if (!ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Active organization is required",
				});
			}

			if (input.role === "owner") {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Cannot create a user with the owner role",
				});
			}

			return await createOrganizationUserWithCredentials({
				organizationId: ctx.session.activeOrganizationId,
				email: input.email,
				password: input.password,
				role: input.role,
			});
		}

		case UserMethod.sendInvitation: {
			const input = decodeArgs<{
				invitationId: string;
				notificationId: string;
			}>(call.payload);
			if (IS_CLOUD) {
				return;
			}

			const notification = await findNotificationById(input.notificationId);

			const email = notification.email;
			const resend = notification.resend;

			const currentInvitation = await db.query.invitation.findFirst({
				where: eq(invitation.id, input.invitationId),
			});

			if (!email && !resend) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Email provider not found",
				});
			}

			const host =
				process.env.NODE_ENV === "development"
					? "http://localhost:3000"
					: await getHanzoUrl();
			const inviteLink = `${host}/invitation?token=${input.invitationId}`;

			const organization = await findOrganizationById(
				ctx.session.activeOrganizationId,
			);

			try {
				const htmlContent = `
				<p>You are invited to join ${organization?.name || "organization"} on Hanzo Platform. Click the link to accept the invitation: <a href="${inviteLink}">Accept Invitation</a></p>
				`;

				if (email) {
					await sendEmailNotification(
						{ ...email, toAddresses: [toEmail] },
						subject,
						html,
					);
				} else if (resend) {
					await sendResendNotification(
						{ ...resend, toAddresses: [toEmail] },
						subject,
						html,
					);
				}
			} catch (error) {
				console.log(error);
				throw error;
			}
			await audit(ctx, {
				action: "create",
				resourceType: "user",
				resourceId: input.invitationId,
				resourceName: currentInvitation?.email || "",
				metadata: { type: "sendInvitation" },
			});
			return inviteLink;
		}

		case UserMethod.getBookmarkedTemplates: {
			const result = await db.query.user.findFirst({
				where: eq(user.id, ctx.user.id),
				columns: { bookmarkedTemplates: true },
			});

			return result?.bookmarkedTemplates ?? [];
		}

		case UserMethod.toggleTemplateBookmark: {
			const input = decodeArgs<{ templateId: string }>(call.payload);
			const result = await db.query.user.findFirst({
				where: eq(user.id, ctx.user.id),
				columns: { bookmarkedTemplates: true },
			});

			const current = result?.bookmarkedTemplates ?? [];
			const isBookmarked = current.includes(input.templateId);

			const updated = isBookmarked
				? current.filter((id) => id !== input.templateId)
				: [...current, input.templateId];

			await db
				.update(user)
				.set({ bookmarkedTemplates: updated })
				.where(eq(user.id, ctx.user.id));

			return { isBookmarked: !isBookmarked };
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
