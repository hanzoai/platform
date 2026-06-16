// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// notification-cap.ts — the native @zap-proto/web Notification capability.
//
// Binary-ZAP replacement for the browser-facing half of the tRPC
// `notificationRouter` (server/api/routers/notification.ts). Every migrated
// method was a session-gated `withPermission("notification", <action>)`
// procedure — an authenticated caller (session+user) whose body additionally
// enforces per-notification org ownership. The mint boundary requires
// session+user (a null return rejects the WS upgrade with HTTP 401, mirroring
// protectedProcedure); the per-notification ownership / IS_CLOUD checks are
// enforced INSIDE dispatch, verbatim from the original procedure bodies.
//
// NOT migrated: the router's `receiveNotification` procedure. It is a PUBLIC
// server-to-server webhook (remote monitoring agents POST to
// `/api/trpc/notification.receiveNotification` with a body-carried token, NOT a
// browser session); it remains a tRPC HTTP endpoint in the slimmed router.
//
// Inputs ride the shared Args carrier (decodeArgs); results the shared Result
// carrier (encodeResult). The NotificationMethod ordinal table is generated from
// notification.zap — this file holds only the auth gate and the service routing.

import type { IncomingMessage } from "node:http";
import {
	createCustomNotification,
	createDiscordNotification,
	createEmailNotification,
	createGotifyNotification,
	createLarkNotification,
	createMattermostNotification,
	createNtfyNotification,
	createPushoverNotification,
	createResendNotification,
	createSlackNotification,
	createTeamsNotification,
	createTelegramNotification,
	findNotificationById,
	IS_CLOUD,
	removeNotificationById,
	sendCustomNotification,
	sendDiscordNotification,
	sendEmailNotification,
	sendGotifyNotification,
	sendLarkNotification,
	sendMattermostNotification,
	sendNtfyNotification,
	sendPushoverNotification,
	sendResendNotification,
	sendSlackNotification,
	sendTeamsNotification,
	sendTelegramNotification,
	updateCustomNotification,
	updateDiscordNotification,
	updateEmailNotification,
	updateGotifyNotification,
	updateLarkNotification,
	updateMattermostNotification,
	updateNtfyNotification,
	updatePushoverNotification,
	updateResendNotification,
	updateSlackNotification,
	updateTeamsNotification,
	updateTelegramNotification,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { desc, eq } from "drizzle-orm";
import { notifications } from "@/server/db/schema";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { NotificationMethod } from "./schema/notification_zap";

/** Per-connection auth context — the tRPC ctx shape the ported bodies expect. */
export interface NotificationCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
}

/**
 * notificationMintCap — bearer→ctx boundary. Mirrors
 * `withPermission("notification", …)`'s authentication half (a
 * `protectedProcedure` base): validates the upgrade and requires session+user.
 * Null → HTTP 401 before any socket opens. The per-notification org-ownership /
 * IS_CLOUD half runs inside dispatch (verbatim from the bodies).
 */
export const notificationMintCap: MintCap<NotificationCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as NotificationCtx["userRole"];
	const userId = (user as { id?: string }).id || "";
	return { organizationId, userRole, userId };
};

/** Typed errors → ZAP status codes (mirror the tRPC error codes). */
class BadRequestError extends Error {}
class UnauthorizedError extends Error {}

/**
 * notificationRootCap — the connection's dispatch root. For each decoded Call,
 * decode the input via the shared Args carrier, run the matching service
 * function (the very same one the tRPC procedure ran), and encode the result.
 * Errors map to ZAP status codes, never a thrown HTTP 500 leak.
 */
export function notificationRootCap(ctx: NotificationCtx): CallHandler {
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

// Drizzle-derived procedure inputs are carried untyped via the Args carrier;
// each body destructures the fields it needs (notificationId, name, channel, …).
type Input = Record<string, unknown> & {
	notificationId: string;
	name: string;
	channel: string;
	decoration?: boolean;
	username?: string;
};

async function dispatch(ctx: NotificationCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		// -------------------------------------------------------------------
		// Slack
		// -------------------------------------------------------------------
		case NotificationMethod.createSlack: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await createSlackNotification(input, ctx.organizationId);
				console.info("[audit] notification.create", {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				return null;
			} catch (error) {
				console.log(error);
				throw new BadRequestError("Error creating the notification");
			}
		}
		case NotificationMethod.updateSlack: {
			const input = decodeArgs<Input>(call.payload);
			const notification = await findNotificationById(input.notificationId);
			if (notification.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not authorized to update this notification",
				);
			}
			const result = await updateSlackNotification({
				...input,
				organizationId: ctx.organizationId,
			});
			console.info("[audit] notification.update", {
				action: "update",
				resourceType: "notification",
				resourceId: input.notificationId,
				resourceName: notification.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
			});
			return result;
		}
		case NotificationMethod.testSlackConnection: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await sendSlackNotification(input, {
					channel: input.channel,
					text: "Hi, From Hanzo Platform 👋",
				});
				return true;
			} catch (error) {
				throw new BadRequestError(
					`${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}

		// -------------------------------------------------------------------
		// Telegram
		// -------------------------------------------------------------------
		case NotificationMethod.createTelegram: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await createTelegramNotification(input, ctx.organizationId);
				console.info("[audit] notification.create", {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				return null;
			} catch (_error) {
				throw new BadRequestError("Error creating the notification");
			}
		}
		case NotificationMethod.updateTelegram: {
			const input = decodeArgs<Input>(call.payload);
			try {
				const notification = await findNotificationById(input.notificationId);
				if (notification.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You are not authorized to update this notification",
					);
				}
				const result = await updateTelegramNotification({
					...input,
					organizationId: ctx.organizationId,
				});
				console.info("[audit] notification.update", {
					action: "update",
					resourceType: "notification",
					resourceId: input.notificationId,
					resourceName: notification.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				return result;
			} catch (error) {
				if (error instanceof UnauthorizedError) throw error;
				throw new BadRequestError("Error updating the notification");
			}
		}
		case NotificationMethod.testTelegramConnection: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await sendTelegramNotification(input, "Hi, From Hanzo Platform 👋");
				return true;
			} catch (_error) {
				throw new BadRequestError("Error testing the notification");
			}
		}

		// -------------------------------------------------------------------
		// Discord
		// -------------------------------------------------------------------
		case NotificationMethod.createDiscord: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await createDiscordNotification(input, ctx.organizationId);
				console.info("[audit] notification.create", {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				return null;
			} catch (_error) {
				throw new BadRequestError("Error creating the notification");
			}
		}
		case NotificationMethod.updateDiscord: {
			const input = decodeArgs<Input>(call.payload);
			try {
				const notification = await findNotificationById(input.notificationId);
				if (notification.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You are not authorized to update this notification",
					);
				}
				const result = await updateDiscordNotification({
					...input,
					organizationId: ctx.organizationId,
				});
				console.info("[audit] notification.update", {
					action: "update",
					resourceType: "notification",
					resourceId: input.notificationId,
					resourceName: notification.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				return result;
			} catch (error) {
				if (error instanceof UnauthorizedError) throw error;
				throw new BadRequestError("Error updating the notification");
			}
		}
		case NotificationMethod.testDiscordConnection: {
			const input = decodeArgs<Input>(call.payload);
			try {
				const decorate = (decoration: string, text: string) =>
					`${input.decoration ? decoration : ""} ${text}`.trim();

				await sendDiscordNotification(input, {
					title: decorate(">", "`🤚` - Test Notification"),
					description: decorate(">", "Hi, From Hanzo Platform 👋"),
					color: 0xf3f7f4,
				});

				return true;
			} catch (error) {
				throw new BadRequestError(
					`${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}

		// -------------------------------------------------------------------
		// Email
		// -------------------------------------------------------------------
		case NotificationMethod.createEmail: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await createEmailNotification(input, ctx.organizationId);
				console.info("[audit] notification.create", {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				return null;
			} catch (_error) {
				throw new BadRequestError("Error creating the notification");
			}
		}
		case NotificationMethod.updateEmail: {
			const input = decodeArgs<Input>(call.payload);
			try {
				const notification = await findNotificationById(input.notificationId);
				if (notification.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You are not authorized to update this notification",
					);
				}
				const result = await updateEmailNotification({
					...input,
					organizationId: ctx.organizationId,
				});
				console.info("[audit] notification.update", {
					action: "update",
					resourceType: "notification",
					resourceId: input.notificationId,
					resourceName: notification.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				return result;
			} catch (error) {
				if (error instanceof UnauthorizedError) throw error;
				throw new BadRequestError("Error updating the notification");
			}
		}
		case NotificationMethod.testEmailConnection: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await sendEmailNotification(
					input,
					"Test Email",
					"<p>Hi, From Hanzo Platform 👋</p>",
				);
				return true;
			} catch (error) {
				throw new BadRequestError(
					`${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}

		// -------------------------------------------------------------------
		// Resend
		// -------------------------------------------------------------------
		case NotificationMethod.createResend: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await createResendNotification(input, ctx.organizationId);
				console.info("[audit] notification.create", {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				return null;
			} catch (_error) {
				throw new BadRequestError("Error creating the notification");
			}
		}
		case NotificationMethod.updateResend: {
			const input = decodeArgs<Input>(call.payload);
			try {
				const notification = await findNotificationById(input.notificationId);
				if (notification.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You are not authorized to update this notification",
					);
				}
				const result = await updateResendNotification({
					...input,
					organizationId: ctx.organizationId,
				});
				console.info("[audit] notification.update", {
					action: "update",
					resourceType: "notification",
					resourceId: input.notificationId,
					resourceName: notification.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				return result;
			} catch (error) {
				if (error instanceof UnauthorizedError) throw error;
				throw new BadRequestError("Error updating the notification");
			}
		}
		case NotificationMethod.testResendConnection: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await sendResendNotification(
					input,
					"Test Email",
					"<p>Hi, From Hanzo Platform 👋</p>",
				);
				return true;
			} catch (error) {
				throw new BadRequestError(
					`${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}

		// -------------------------------------------------------------------
		// remove / one / all
		// -------------------------------------------------------------------
		case NotificationMethod.remove: {
			const input = decodeArgs<Input>(call.payload);
			try {
				const notification = await findNotificationById(input.notificationId);
				if (notification.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You are not authorized to delete this notification",
					);
				}
				console.info("[audit] notification.delete", {
					action: "delete",
					resourceType: "notification",
					resourceName: notification.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				return await removeNotificationById(input.notificationId);
			} catch (error) {
				if (error instanceof UnauthorizedError) throw error;
				const message =
					error instanceof Error
						? error.message
						: "Error deleting this notification";
				throw new BadRequestError(message);
			}
		}
		case NotificationMethod.one: {
			const input = decodeArgs<Input>(call.payload);
			const notification = await findNotificationById(input.notificationId);
			if (notification.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not authorized to access this notification",
				);
			}
			return notification;
		}
		case NotificationMethod.all: {
			return await db.query.notifications.findMany({
				with: {
					slack: true,
					telegram: true,
					discord: true,
					email: true,
					resend: true,
					gotify: true,
					ntfy: true,
					mattermost: true,
					custom: true,
					lark: true,
					pushover: true,
					teams: true,
				},
				orderBy: desc(notifications.createdAt),
				where: eq(notifications.organizationId, ctx.organizationId),
			});
		}

		// -------------------------------------------------------------------
		// Gotify
		// -------------------------------------------------------------------
		case NotificationMethod.createGotify: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await createGotifyNotification(input, ctx.organizationId);
				console.info("[audit] notification.create", {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				return null;
			} catch (_error) {
				throw new BadRequestError("Error creating the notification");
			}
		}
		case NotificationMethod.updateGotify: {
			const input = decodeArgs<Input>(call.payload);
			const notification = await findNotificationById(input.notificationId);
			if (IS_CLOUD && notification.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not authorized to update this notification",
				);
			}
			const result = await updateGotifyNotification({
				...input,
				organizationId: ctx.organizationId,
			});
			console.info("[audit] notification.update", {
				action: "update",
				resourceType: "notification",
				resourceId: input.notificationId,
				resourceName: notification.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
			});
			return result;
		}
		case NotificationMethod.testGotifyConnection: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await sendGotifyNotification(
					input,
					"Test Notification",
					"Hi, From Hanzo Platform 👋",
				);
				return true;
			} catch (_error) {
				throw new BadRequestError("Error testing the notification");
			}
		}

		// -------------------------------------------------------------------
		// Ntfy
		// -------------------------------------------------------------------
		case NotificationMethod.createNtfy: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await createNtfyNotification(input, ctx.organizationId);
				console.info("[audit] notification.create", {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				return null;
			} catch (_error) {
				throw new BadRequestError("Error creating the notification");
			}
		}
		case NotificationMethod.updateNtfy: {
			const input = decodeArgs<Input>(call.payload);
			const notification = await findNotificationById(input.notificationId);
			if (IS_CLOUD && notification.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not authorized to update this notification",
				);
			}
			const result = await updateNtfyNotification({
				...input,
				organizationId: ctx.organizationId,
			});
			console.info("[audit] notification.update", {
				action: "update",
				resourceType: "notification",
				resourceId: input.notificationId,
				resourceName: notification.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
			});
			return result;
		}
		case NotificationMethod.testNtfyConnection: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await sendNtfyNotification(
					input,
					"Test Notification",
					"",
					"view, visit Hanzo Platform on Github, https://github.com/hanzoai/platform, clear=true;",
					"Hi, From Hanzo Platform 👋",
				);
				return true;
			} catch (_error) {
				throw new BadRequestError("Error testing the notification");
			}
		}

		// -------------------------------------------------------------------
		// Mattermost
		// -------------------------------------------------------------------
		case NotificationMethod.createMattermost: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await createMattermostNotification(input, ctx.organizationId);
				console.info("[audit] notification.create", {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				return null;
			} catch (_error) {
				throw new BadRequestError("Error creating the notification");
			}
		}
		case NotificationMethod.updateMattermost: {
			const input = decodeArgs<Input>(call.payload);
			const notification = await findNotificationById(input.notificationId);
			if (IS_CLOUD && notification.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not authorized to update this notification",
				);
			}
			const result = await updateMattermostNotification({
				...input,
				organizationId: ctx.organizationId,
			});
			console.info("[audit] notification.update", {
				action: "update",
				resourceType: "notification",
				resourceId: input.notificationId,
				resourceName: notification.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
			});
			return result;
		}
		case NotificationMethod.testMattermostConnection: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await sendMattermostNotification(input, {
					text: "Hi, From Dokploy 👋",
					channel: input.channel,
					username: input.username || "Dokploy Bot",
				});
				return true;
			} catch (_error) {
				throw new BadRequestError("Error testing the notification");
			}
		}

		// -------------------------------------------------------------------
		// Custom
		// -------------------------------------------------------------------
		case NotificationMethod.createCustom: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await createCustomNotification(input, ctx.organizationId);
				console.info("[audit] notification.create", {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				return null;
			} catch (_error) {
				throw new BadRequestError("Error creating the notification");
			}
		}
		case NotificationMethod.updateCustom: {
			const input = decodeArgs<Input>(call.payload);
			const notification = await findNotificationById(input.notificationId);
			if (notification.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not authorized to update this notification",
				);
			}
			const result = await updateCustomNotification({
				...input,
				organizationId: ctx.organizationId,
			});
			console.info("[audit] notification.update", {
				action: "update",
				resourceType: "notification",
				resourceId: input.notificationId,
				resourceName: notification.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
			});
			return result;
		}
		case NotificationMethod.testCustomConnection: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await sendCustomNotification(input, {
					title: "Test Notification",
					message: "Hi, From Dokploy 👋",
					timestamp: new Date().toISOString(),
				});
				return true;
			} catch (error) {
				throw new BadRequestError(
					`${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}

		// -------------------------------------------------------------------
		// Lark
		// -------------------------------------------------------------------
		case NotificationMethod.createLark: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await createLarkNotification(input, ctx.organizationId);
				console.info("[audit] notification.create", {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				return null;
			} catch (_error) {
				throw new BadRequestError("Error creating the notification");
			}
		}
		case NotificationMethod.updateLark: {
			const input = decodeArgs<Input>(call.payload);
			const notification = await findNotificationById(input.notificationId);
			if (IS_CLOUD && notification.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not authorized to update this notification",
				);
			}
			const result = await updateLarkNotification({
				...input,
				organizationId: ctx.organizationId,
			});
			console.info("[audit] notification.update", {
				action: "update",
				resourceType: "notification",
				resourceId: input.notificationId,
				resourceName: notification.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
			});
			return result;
		}
		case NotificationMethod.testLarkConnection: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await sendLarkNotification(input, {
					msg_type: "text",
					content: {
						text: "Hi, From Dokploy 👋",
					},
				});
				return true;
			} catch (_error) {
				throw new BadRequestError("Error testing the notification");
			}
		}

		// -------------------------------------------------------------------
		// Teams
		// -------------------------------------------------------------------
		case NotificationMethod.createTeams: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await createTeamsNotification(input, ctx.organizationId);
				console.info("[audit] notification.create", {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				return null;
			} catch (_error) {
				throw new BadRequestError("Error creating the notification");
			}
		}
		case NotificationMethod.updateTeams: {
			const input = decodeArgs<Input>(call.payload);
			const notification = await findNotificationById(input.notificationId);
			if (IS_CLOUD && notification.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not authorized to update this notification",
				);
			}
			const result = await updateTeamsNotification({
				...input,
				organizationId: ctx.organizationId,
			});
			console.info("[audit] notification.update", {
				action: "update",
				resourceType: "notification",
				resourceId: input.notificationId,
				resourceName: notification.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
			});
			return result;
		}
		case NotificationMethod.testTeamsConnection: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await sendTeamsNotification(input, {
					title: "🤚 Test Notification",
					facts: [{ name: "Message", value: "Hi, From Dokploy 👋" }],
				});
				return true;
			} catch (error) {
				throw new BadRequestError(
					`${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}

		// -------------------------------------------------------------------
		// Pushover
		// -------------------------------------------------------------------
		case NotificationMethod.createPushover: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await createPushoverNotification(input, ctx.organizationId);
				console.info("[audit] notification.create", {
					action: "create",
					resourceType: "notification",
					resourceName: input.name,
					organizationId: ctx.organizationId,
					userId: ctx.userId,
				});
				return null;
			} catch (_error) {
				throw new BadRequestError("Error creating the notification");
			}
		}
		case NotificationMethod.updatePushover: {
			const input = decodeArgs<Input>(call.payload);
			const notification = await findNotificationById(input.notificationId);
			if (IS_CLOUD && notification.organizationId !== ctx.organizationId) {
				throw new UnauthorizedError(
					"You are not authorized to update this notification",
				);
			}
			const result = await updatePushoverNotification({
				...input,
				organizationId: ctx.organizationId,
			});
			console.info("[audit] notification.update", {
				action: "update",
				resourceType: "notification",
				resourceId: input.notificationId,
				resourceName: notification.name,
				organizationId: ctx.organizationId,
				userId: ctx.userId,
			});
			return result;
		}
		case NotificationMethod.testPushoverConnection: {
			const input = decodeArgs<Input>(call.payload);
			try {
				await sendPushoverNotification(
					input,
					"Test Notification",
					"Hi, From Dokploy 👋",
				);
				return true;
			} catch (_error) {
				throw new BadRequestError("Error testing the notification");
			}
		}

		// -------------------------------------------------------------------
		// getEmailProviders
		// -------------------------------------------------------------------
		case NotificationMethod.getEmailProviders: {
			return await db.query.notifications.findMany({
				where: eq(notifications.organizationId, ctx.organizationId),
				with: {
					email: true,
					resend: true,
				},
			});
		}

		default:
			throw new BadRequestError(`unknown method ${call.method}`);
	}
}
