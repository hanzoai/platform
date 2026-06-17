import {
	findApplicationById,
	findComposeById,
	findServerById,
	IS_CLOUD,
	removeScheduleJob,
	scheduleJob,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { deployments } from "@hanzo/platform/db/schema/deployment";
import {
	createScheduleSchema,
	schedules,
	updateScheduleSchema,
} from "@hanzo/platform/db/schema/schedule";
import { runCommand } from "@hanzo/platform/index";
import {
	createSchedule,
	deleteSchedule,
	findScheduleById,
	updateSchedule,
} from "@hanzo/platform/services/schedule";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { removeJob, schedule } from "@/server/utils/backup";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Verify org ownership for a schedule by checking its parent resource.
 */
async function assertScheduleOrgAccess(
	scheduleRecord: {
		applicationId?: string | null;
		composeId?: string | null;
		serverId?: string | null;
	},
	activeOrganizationId: string,
): Promise<void> {
	if (scheduleRecord.applicationId) {
		const app = await findApplicationById(scheduleRecord.applicationId);
		if (
			app.environment.project.organizationId !== activeOrganizationId
		) {
			throw new TRPCError({
				code: "UNAUTHORIZED",
				message: "You are not authorized to access this schedule",
			});
		}
	} else if (scheduleRecord.composeId) {
		const compose = await findComposeById(scheduleRecord.composeId);
		if (
			compose.environment.project.organizationId !== activeOrganizationId
		) {
			throw new TRPCError({
				code: "UNAUTHORIZED",
				message: "You are not authorized to access this schedule",
			});
		}
	} else if (scheduleRecord.serverId) {
		const server = await findServerById(scheduleRecord.serverId);
		if (server.organizationId !== activeOrganizationId) {
			throw new TRPCError({
				code: "UNAUTHORIZED",
				message: "You are not authorized to access this schedule",
			});
		}
	}
}

export const scheduleRouter = createTRPCRouter({
	create: protectedProcedure
		.input(createScheduleSchema)
		.mutation(async ({ input, ctx }) => {
			const newSchedule = await createSchedule(input);

			if (!newSchedule) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create schedule",
				});
			}

			// Verify org ownership on the newly created schedule
			await assertScheduleOrgAccess(newSchedule, ctx.session.activeOrganizationId);

			if (newSchedule?.enabled) {
				if (IS_CLOUD) {
					schedule({
						scheduleId: newSchedule.scheduleId,
						type: "schedule",
						cronSchedule: newSchedule.cronExpression,
					});
				} else {
					scheduleJob(newSchedule);
				}
			}
			return newSchedule;
		}),

	update: protectedProcedure
		.input(updateScheduleSchema)
		.mutation(async ({ input, ctx }) => {
			// Verify org ownership before update
			const existing = await findScheduleById(input.scheduleId);
			await assertScheduleOrgAccess(existing, ctx.session.activeOrganizationId);

			const updatedSchedule = await updateSchedule(input);

			if (IS_CLOUD) {
				if (updatedSchedule?.enabled) {
					schedule({
						scheduleId: updatedSchedule.scheduleId,
						type: "schedule",
						cronSchedule: updatedSchedule.cronExpression,
					});
				} else {
					await removeJob({
						cronSchedule: updatedSchedule.cronExpression,
						scheduleId: updatedSchedule.scheduleId,
						type: "schedule",
					});
				}
			} else {
				if (updatedSchedule?.enabled) {
					removeScheduleJob(updatedSchedule.scheduleId);
					scheduleJob(updatedSchedule);
				} else {
					removeScheduleJob(updatedSchedule.scheduleId);
				}
			}
			return updatedSchedule;
		}),

	delete: protectedProcedure
		.input(z.object({ scheduleId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			const scheduleRecord = await findScheduleById(input.scheduleId);
			await assertScheduleOrgAccess(scheduleRecord, ctx.session.activeOrganizationId);

			await deleteSchedule(input.scheduleId);

			if (IS_CLOUD) {
				await removeJob({
					cronSchedule: scheduleRecord.cronExpression,
					scheduleId: scheduleRecord.scheduleId,
					type: "schedule",
				});
			} else {
				removeScheduleJob(scheduleRecord.scheduleId);
			}
			return true;
		}),

	list: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				scheduleType: z.enum([
					"application",
					"compose",
					"server",
					"platform-server",
				]),
			}),
		)
		.query(async ({ input, ctx }) => {
			// Verify org ownership for the parent resource
			if (input.scheduleType === "application") {
				const app = await findApplicationById(input.id);
				if (
					app.environment.project.organizationId !==
					ctx.session.activeOrganizationId
				) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to access this resource",
					});
				}
			} else if (input.scheduleType === "compose") {
				const compose = await findComposeById(input.id);
				if (
					compose.environment.project.organizationId !==
					ctx.session.activeOrganizationId
				) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to access this resource",
					});
				}
			} else if (input.scheduleType === "server") {
				const server = await findServerById(input.id);
				if (server.organizationId !== ctx.session.activeOrganizationId) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to access this resource",
					});
				}
			}

			const where = {
				application: eq(schedules.applicationId, input.id),
				compose: eq(schedules.composeId, input.id),
				server: eq(schedules.serverId, input.id),
				"platform-server": eq(schedules.userId, input.id),
			};
			return db.query.schedules.findMany({
				where: where[input.scheduleType],
				with: {
					application: true,
					server: true,
					compose: true,
					deployments: {
						orderBy: [desc(deployments.createdAt)],
					},
				},
			});
		}),

	one: protectedProcedure
		.input(z.object({ scheduleId: z.string() }))
		.query(async ({ input, ctx }) => {
			const scheduleRecord = await findScheduleById(input.scheduleId);
			await assertScheduleOrgAccess(scheduleRecord, ctx.session.activeOrganizationId);
			return scheduleRecord;
		}),

	runManually: protectedProcedure
		.input(z.object({ scheduleId: z.string().min(1) }))
		.mutation(async ({ input, ctx }) => {
			const scheduleRecord = await findScheduleById(input.scheduleId);
			await assertScheduleOrgAccess(scheduleRecord, ctx.session.activeOrganizationId);

			try {
				await runCommand(input.scheduleId);
				return true;
			} catch (error) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message:
						error instanceof Error ? error.message : "Error running schedule",
				});
			}
		}),
});
