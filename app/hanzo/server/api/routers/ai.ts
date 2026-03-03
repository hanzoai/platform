import { slugify } from "@/lib/slug";
import {
	adminProcedure,
	createTRPCRouter,
	protectedProcedure,
} from "@/server/api/trpc";
import { generatePassword } from "@/templates/utils";
import { IS_CLOUD } from "@hanzo/core/constants";
import {
	apiCreateAi,
	apiUpdateAi,
	deploySuggestionSchema,
} from "@hanzo/core/db/schema/ai";
import { createDomain, createMount } from "@hanzo/core/index";
import {
	deleteAiSettings,
	getAiSettingById,
	getAiSettingsByOrganizationId,
	saveAiSettings,
	suggestVariants,
} from "@hanzo/core/services/ai";
// Removed compose service
import { findProjectById } from "@hanzo/core/services/project";
import { addNewService, checkServiceAccess } from "@hanzo/core/services/user";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const aiRouter = createTRPCRouter({
	one: protectedProcedure
		.input(z.object({ aiId: z.string() }))
		.query(async ({ ctx, input }) => {
			const aiSetting = await getAiSettingById(input.aiId);
			if (aiSetting.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You don't have access to this AI configuration",
				});
			}
			return aiSetting;
		}),

	getModels: protectedProcedure
		.input(z.object({ apiUrl: z.string().min(1), apiKey: z.string().min(1) }))
		.query(async ({ input }) => {
			try {
				// Simplified model fetching without provider headers
				const headers = {
					'Authorization': `Bearer ${input.apiKey}`,
					'Content-Type': 'application/json'
				};
				const response = await fetch(`${input.apiUrl}/models`, { headers });

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(`Failed to fetch models: ${errorText}`);
				}

				const res = await response.json();

				if (Array.isArray(res)) {
					return res.map((model) => ({
						id: model.id || model.name,
						object: "model",
						created: Date.now(),
						owned_by: "provider",
					}));
				}

				if (res.models) {
					return res.models.map((model: any) => ({
						id: model.id || model.name,
						object: "model",
						created: Date.now(),
						owned_by: "provider",
					}));
				}

				if (res.data) {
					return res.data;
				}

				const possibleModels =
					(Object.values(res).find(Array.isArray) as any[]) || [];
				return possibleModels.map((model) => ({
					id: model.id || model.name,
					object: "model",
					created: Date.now(),
					owned_by: "provider",
				}));
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: error instanceof Error ? error?.message : `Error: ${error}`,
				});
			}
		}),
	create: adminProcedure.input(apiCreateAi).mutation(async ({ ctx, input }) => {
		return await saveAiSettings(ctx.session.activeOrganizationId, input);
	}),

	update: protectedProcedure
		.input(apiUpdateAi)
		.mutation(async ({ ctx, input }) => {
			return await saveAiSettings(ctx.session.activeOrganizationId, input);
		}),

	getAll: adminProcedure.query(async ({ ctx }) => {
		return await getAiSettingsByOrganizationId(
			ctx.session.activeOrganizationId,
		);
	}),

	get: protectedProcedure
		.input(z.object({ aiId: z.string() }))
		.query(async ({ ctx, input }) => {
			const aiSetting = await getAiSettingById(input.aiId);
			if (aiSetting.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You don't have access to this AI configuration",
				});
			}
			return aiSetting;
		}),

	delete: protectedProcedure
		.input(z.object({ aiId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const aiSetting = await getAiSettingById(input.aiId);
			if (aiSetting.organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You don't have access to this AI configuration",
				});
			}
			return await deleteAiSettings(input.aiId);
		}),

	suggest: protectedProcedure
		.input(
			z.object({
				aiId: z.string(),
				input: z.string(),
				serverId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				return await suggestVariants({
					...input,
					organizationId: ctx.session.activeOrganizationId,
				});
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: error instanceof Error ? error?.message : `Error: ${error}`,
				});
			}
		}),
	deploy: protectedProcedure
		.input(deploySuggestionSchema)
		.mutation(async ({ ctx, input }) => {
			// Compose functionality has been removed
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Docker Compose deployment functionality has been removed",
			});
		}),
});
