// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// notificationRouter — the residual tRPC surface after the browser-facing
// Notification procedures migrated to native ZAP (server/zap/notification-cap.ts,
// utils/zap-notification.ts).
//
// Only `receiveNotification` remains: it is a PUBLIC server-to-server webhook
// that remote monitoring agents POST to over tRPC HTTP
// (`/api/trpc/notification.receiveNotification`) with a body-carried token (NOT
// a browser session cookie). It cannot move onto the session-minted ZAP WS
// without breaking remote metrics callbacks, so it stays here as the sole
// publicProcedure.

import {
	getWebServerSettings,
	sendServerThresholdNotifications,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { server } from "@/server/db/schema";

export const notificationRouter = createTRPCRouter({
	receiveNotification: publicProcedure
		.input(
			z.object({
				ServerType: z
					.enum(["Hanzo Platform", "Remote"])
					.default("Hanzo Platform"),
				Type: z.enum(["Memory", "CPU"]),
				Value: z.number(),
				Threshold: z.number(),
				Message: z.string(),
				Timestamp: z.string(),
				Token: z.string(),
			}),
		)
		.mutation(async ({ input }) => {
			try {
				let organizationId = "";
				let ServerName = "";
				if (input.ServerType === "Hanzo Platform") {
					const settings = await getWebServerSettings();
					if (
						!settings?.metricsConfig?.server?.token ||
						settings.metricsConfig.server.token !== input.Token
					) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: "Token not found",
						});
					}

					// For Hanzo Platform server type, we don't have a specific organizationId
					// This might need to be adjusted based on your business logic
					organizationId = "";
					ServerName = "Hanzo Platform";
				} else {
					const result = await db
						.select()
						.from(server)
						.where(
							sql`json_extract(${server.metricsConfig}, '$.server.token') = ${input.Token}`,
						);

					if (!result?.[0]?.organizationId) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: "Token not found",
						});
					}

					organizationId = result?.[0]?.organizationId;
					ServerName = "Remote";
				}

				await sendServerThresholdNotifications(organizationId, {
					...input,
					ServerName,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error sending the notification",
					cause: error,
				});
			}
		}),
});
