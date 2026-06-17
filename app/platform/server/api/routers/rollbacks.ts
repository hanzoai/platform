import {
	findRollbackById,
	removeRollbackById,
	rollback,
} from "@hanzo/platform";
import { TRPCError } from "@trpc/server";
import { audit } from "@/server/api/utils/audit";
import { checkServicePermissionAndAccess } from "@hanzo/platform/services/permission";
import { apiFindOneRollback } from "@/server/db/schema";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const rollbackRouter = createTRPCRouter({
	delete: protectedProcedure
		.input(apiFindOneRollback)
		.mutation(async ({ input, ctx }) => {
			try {
				const currentRollback = await findRollbackById(input.rollbackId);
				if (
					currentRollback?.deployment?.application?.environment?.project
						.organizationId !== ctx.session.activeOrganizationId
				) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to delete this rollback",
					});
				}
				return removeRollbackById(input.rollbackId);
			} catch (error) {
				if (error instanceof TRPCError) {
					throw error;
				}
				const message =
					error instanceof Error
						? error.message
						: "Error input: Deleting rollback";
				throw new TRPCError({
					code: "BAD_REQUEST",
					message,
				});
			}
		}),
	rollback: protectedProcedure
		.input(apiFindOneRollback)
		.mutation(async ({ input, ctx }) => {
			try {
				const rb = await findRollbackById(input.rollbackId);
				const serviceId = rb.deployment.applicationId;
				if (serviceId) {
					await checkServicePermissionAndAccess(ctx, serviceId, {
						deployment: ["create"],
					});
				}
				const result = await rollback(input.rollbackId);
				await audit(ctx, {
					action: "restore",
					resourceType: "deployment",
					resourceId: input.rollbackId,
				});
				return result;
			} catch (error) {
				console.error(error);
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error input: Rolling back",
					cause: error,
				});
			}
		}),
});
