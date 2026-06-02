import {
	createGitlab,
	findGitlabById,
	getAccessibleGitProviderIds,
	getGitlabBranches,
	getGitlabRepositories,
	haveGitlabRequirements,
	testGitlabConnection,
	updateGitlab,
	updateGitProvider,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { TRPCError } from "@trpc/server";
import {
	createTRPCRouter,
	protectedProcedure,
	withPermission,
} from "@/server/api/trpc";
import { audit } from "@/server/api/utils/audit";
import {
	apiCreateGitlab,
	apiFindGitlabBranches,
	apiFindOneGitlab,
	apiGitlabTestConnection,
	apiUpdateGitlab,
} from "@/server/db/schema";

export const gitlabRouter = createTRPCRouter({
	create: withPermission("gitProviders", "create")
		.input(apiCreateGitlab)
		.mutation(async ({ input, ctx }) => {
			try {
				const result = await createGitlab(
					input,
					ctx.session.activeOrganizationId,
					ctx.session.userId,
				);

				await audit(ctx, {
					action: "create",
					resourceType: "gitProvider",
					resourceName: input.name,
				});

				return result;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Error creating this Gitlab provider",
					cause: error,
				});
			}
		}),
	one: protectedProcedure.input(apiFindOneGitlab).query(async ({ input }) => {
		return await findGitlabById(input.gitlabId);
	}),
	gitlabProviders: protectedProcedure.query(async ({ ctx }) => {
		const accessibleIds = await getAccessibleGitProviderIds(ctx.session);

		let result = await db.query.gitlab.findMany({
			with: {
				gitProvider: true,
			},
		});

		result = result.filter((provider) => {
			return (
				provider.gitProvider.organizationId ===
					ctx.session.activeOrganizationId &&
				accessibleIds.has(provider.gitProvider.gitProviderId)
			);
		});
		const filtered = result
			.filter((provider) => haveGitlabRequirements(provider))
			.map((provider) => {
				return {
					gitlabId: provider.gitlabId,
					gitProvider: {
						...provider.gitProvider,
					},
					gitlabUrl: provider.gitlabUrl,
				};
			});

		return filtered;
	}),
	getGitlabRepositories: protectedProcedure
		.input(apiFindOneGitlab)
		.query(async ({ input }) => {
			return await getGitlabRepositories(input.gitlabId);
		}),

	getGitlabBranches: protectedProcedure
		.input(apiFindGitlabBranches)
		.query(async ({ input, ctx }) => {
			const gitlabProvider = await findGitlabById(input.gitlabId || "");
			if (
				gitlabProvider.gitProvider.organizationId !==
					ctx.session.activeOrganizationId &&
				gitlabProvider.gitProvider.userId !== ctx.session.userId
			) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not allowed to access this Gitlab provider",
				});
			}
			return await getGitlabBranches(input as any);
		}),
	testConnection: protectedProcedure
		.input(apiGitlabTestConnection)
		.mutation(async ({ input }) => {
			try {
				const result = await testGitlabConnection(input);

				return `Found ${result} repositories`;
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: error instanceof Error ? error?.message : `Error: ${error}`,
				});
			}
		}),
	update: withPermission("gitProviders", "create")
		.input(apiUpdateGitlab)
		.mutation(async ({ input, ctx }) => {
			if (input.name) {
				await updateGitProvider(input.gitProviderId, {
					name: input.name,
					organizationId: ctx.session.activeOrganizationId,
				});

				await updateGitlab(input.gitlabId, {
					...input,
				} as any);
			} else {
				await updateGitlab(input.gitlabId, {
					...input,
				} as any);
			}

			await audit(ctx, {
				action: "update",
				resourceType: "gitProvider",
				resourceId: input.gitProviderId,
				resourceName: input.name,
			});
		}),
});
