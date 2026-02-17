import {
	checkServiceAccess,
	cleanPatchRepos,
	createPatch,
	deletePatch,
	ensurePatchRepo,
	findApplicationById,
	findComposeById,
	findPatchByFilePath,
	findPatchById,
	findPatchesByApplicationId,
	findPatchesByComposeId,
	generatePatch,
	readPatchRepoDirectory,
	readPatchRepoFile,
	updatePatch,
} from "@dokploy/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	adminProcedure,
	createTRPCRouter,
	protectedProcedure,
} from "@/server/api/trpc";
import {
	apiCreatePatch,
	apiDeletePatch,
	apiFindPatch,
	apiFindPatchesByApplicationId,
	apiFindPatchesByComposeId,
	apiTogglePatchEnabled,
	apiUpdatePatch,
} from "@/server/db/schema";

export const patchRouter = createTRPCRouter({
	// CRUD Operations
	create: protectedProcedure
		.input(apiCreatePatch)
		.mutation(async ({ input, ctx }) => {
			// Verify access
			if (input.applicationId) {
				const app = await findApplicationById(input.applicationId);
				if (
					app.environment.project.organizationId !==
					ctx.session.activeOrganizationId
				) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to access this application",
					});
				}
				if (ctx.user.role === "member") {
					await checkServiceAccess(
						ctx.user.id,
						input.applicationId,
						ctx.session.activeOrganizationId,
						"access",
					);
				}
			} else if (input.composeId) {
				const compose = await findComposeById(input.composeId);
				if (
					compose.environment.project.organizationId !==
					ctx.session.activeOrganizationId
				) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to access this compose",
					});
				}
			}

			return await createPatch(input);
		}),

	one: protectedProcedure.input(apiFindPatch).query(async ({ input }) => {
		return await findPatchById(input.patchId);
	}),

	byApplicationId: protectedProcedure
		.input(apiFindPatchesByApplicationId)
		.query(async ({ input, ctx }) => {
			const app = await findApplicationById(input.applicationId);
			if (
				app.environment.project.organizationId !==
				ctx.session.activeOrganizationId
			) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to access this application",
				});
			}

			return await findPatchesByApplicationId(input.applicationId);
		}),

	byComposeId: protectedProcedure
		.input(apiFindPatchesByComposeId)
		.query(async ({ input, ctx }) => {
			const compose = await findComposeById(input.composeId);
			if (
				compose.environment.project.organizationId !==
				ctx.session.activeOrganizationId
			) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to access this compose",
				});
			}

			return await findPatchesByComposeId(input.composeId);
		}),

	update: protectedProcedure
		.input(apiUpdatePatch)
		.mutation(async ({ input }) => {
			const { patchId, ...data } = input;
			return await updatePatch(patchId, data);
		}),

	delete: protectedProcedure
		.input(apiDeletePatch)
		.mutation(async ({ input }) => {
			return await deletePatch(input.patchId);
		}),

	toggleEnabled: protectedProcedure
		.input(apiTogglePatchEnabled)
		.mutation(async ({ input }) => {
			return await updatePatch(input.patchId, { enabled: input.enabled });
		}),

	// Repository Operations
	ensureRepo: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				type: z.enum(["application", "compose"]),
			}),
		)
		.mutation(async ({ input }) => {
			return await ensurePatchRepo({
				type: input.type,
				id: input.id,
			});
		}),

	readRepoDirectories: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				type: z.enum(["application", "compose"]),
				repoPath: z.string(),
			}),
		)
		.query(async ({ input, ctx }) => {
			if (input.type === "application") {
				const app = await findApplicationById(input.id);
				if (
					app.environment.project.organizationId !==
					ctx.session.activeOrganizationId
				) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to access this application",
					});
				}
				return await readPatchRepoDirectory(input.repoPath, app.serverId);
			}

			if (input.type === "compose") {
				const compose = await findComposeById(input.id);
				if (
					compose.environment.project.organizationId !==
					ctx.session.activeOrganizationId
				) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to access this compose",
					});
				}
				return await readPatchRepoDirectory(input.repoPath, compose.serverId);
			}

			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Either application or compose must be provided",
			});
		}),

	readRepoFile: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				type: z.enum(["application", "compose"]),
				repoPath: z.string(),
				filePath: z.string(),
			}),
		)
		.query(async ({ input, ctx }) => {
			let serverId: string | null = null;

			if (input.type === "application") {
				const app = await findApplicationById(input.id);
				if (
					app.environment.project.organizationId !==
					ctx.session.activeOrganizationId
				) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to access this application",
					});
				}
				serverId = app.serverId;
			} else if (input.type === "compose") {
				const compose = await findComposeById(input.id);
				if (
					compose.environment.project.organizationId !==
					ctx.session.activeOrganizationId
				) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to access this compose",
					});
				}
				serverId = compose.serverId;
			} else {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Either applicationId or composeId must be provided",
				});
			}
			const existingPatch = await findPatchByFilePath(
				input.filePath,
				input.id,
				input.type,
			);

			return await readPatchRepoFile(
				input.repoPath,
				input.filePath,
				existingPatch?.enabled ? existingPatch?.content : undefined,
				serverId,
			);
		}),

	saveFileAsPatch: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				type: z.enum(["application", "compose"]),
				repoPath: z.string(),
				filePath: z.string(),
				content: z.string(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			let serverId: string | null = null;

			if (input.type === "application") {
				const app = await findApplicationById(input.id);
				if (
					app.environment.project.organizationId !==
					ctx.session.activeOrganizationId
				) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to access this application",
					});
				}
				serverId = app.serverId;
			} else if (input.type === "compose") {
				const compose = await findComposeById(input.id);
				if (
					compose.environment.project.organizationId !==
					ctx.session.activeOrganizationId
				) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to access this compose",
					});
				}
				serverId = compose.serverId;
			} else {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Either application or compose must be provided",
				});
			}

			const newPatch = await createPatch({
				filePath: input.filePath,
				content: input.content,
				applicationId: input.type === "application" ? input.id : undefined,
				composeId: input.type === "compose" ? input.id : undefined,
			});

			return newPatch;
		}),

	// Cleanup
	cleanPatchRepos: adminProcedure
		.input(z.object({ serverId: z.string().optional() }))
		.mutation(async ({ input }) => {
			await cleanPatchRepos(input.serverId);
			return true;
		}),
});
