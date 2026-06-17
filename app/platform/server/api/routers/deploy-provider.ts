import {
	apiCreateDeployProvider,
	apiFindOneDeployProvider,
	apiRemoveDeployProvider,
	apiTestDeployProvider,
	apiUpdateDeployProvider,
} from "@hanzo/platform/db/schema";
import {
	createDeployProvider,
	findDeployProviderById,
	findDeployProvidersByOrg,
	removeDeployProviderById,
	testDeployProviderConnection,
	updateDeployProviderById,
} from "@hanzo/platform/services/deploy-provider";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure, protectedProcedure } from "@/server/api/trpc";

export const deployProviderRouter = createTRPCRouter({
	create: adminProcedure
		.input(apiCreateDeployProvider)
		.mutation(async ({ input, ctx }) => {
			try {
				return await createDeployProvider(
					input,
					ctx.session.activeOrganizationId,
				);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Failed to create deploy provider",
					cause: error,
				});
			}
		}),

	one: protectedProcedure
		.input(apiFindOneDeployProvider)
		.query(async ({ input }) => {
			return findDeployProviderById(input.deployProviderId);
		}),

	all: protectedProcedure.query(async ({ ctx }) => {
		return findDeployProvidersByOrg(ctx.session.activeOrganizationId);
	}),

	update: adminProcedure
		.input(apiUpdateDeployProvider)
		.mutation(async ({ input, ctx }) => {
			const { deployProviderId, ...data } = input;
			try {
				return await updateDeployProviderById(
					deployProviderId,
					ctx.session.activeOrganizationId,
					data,
				);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Failed to update deploy provider",
					cause: error,
				});
			}
		}),

	remove: adminProcedure
		.input(apiRemoveDeployProvider)
		.mutation(async ({ input, ctx }) => {
			try {
				await removeDeployProviderById(
					input.deployProviderId,
					ctx.session.activeOrganizationId,
				);
				return { success: true };
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Failed to remove deploy provider",
					cause: error,
				});
			}
		}),

	testConnection: protectedProcedure
		.input(apiTestDeployProvider)
		.mutation(async ({ input }) => {
			const provider = await findDeployProviderById(input.deployProviderId);
			return testDeployProviderConnection(provider);
		}),
});
