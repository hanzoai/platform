import {
	createMount,
	deleteMount,
	findApplicationById,
	findMountById,
	findMountOrganizationId,
	getServiceContainer,
	updateMount,
} from "@hanzo/platform";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	apiCreateMount,
	apiFindOneMount,
	apiRemoveMount,
	apiUpdateMount,
} from "@/server/db/schema";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const mountRouter = createTRPCRouter({
	create: protectedProcedure
		.input(apiCreateMount)
		.mutation(async ({ input, ctx }) => {
			// Verify the target service belongs to the caller's org
			// by resolving serviceId through findMountOrganizationId-compatible lookup.
			// The mount hasn't been created yet, so we check the target serviceId directly.
			if (input.serviceType === "application") {
				const app = await findApplicationById(input.serviceId);
				if (
					app.environment.project.organizationId !==
					ctx.session.activeOrganizationId
				) {
					throw new TRPCError({
						code: "UNAUTHORIZED",
						message: "You are not authorized to create mounts on this service",
					});
				}
			}
			await createMount(input);
			return true;
		}),
	remove: protectedProcedure
		.input(apiRemoveMount)
		.mutation(async ({ input, ctx }) => {
			const organizationId = await findMountOrganizationId(input.mountId);
			if (organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to delete this mount",
				});
			}
			return await deleteMount(input.mountId);
		}),

	one: protectedProcedure
		.input(apiFindOneMount)
		.query(async ({ input, ctx }) => {
			const organizationId = await findMountOrganizationId(input.mountId);
			if (organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to access this mount",
				});
			}
			return await findMountById(input.mountId);
		}),
	update: protectedProcedure
		.input(apiUpdateMount)
		.mutation(async ({ input, ctx }) => {
			const organizationId = await findMountOrganizationId(input.mountId);
			if (organizationId !== ctx.session.activeOrganizationId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "You are not authorized to update this mount",
				});
			}
			return await updateMount(input.mountId, input);
		}),
	allNamedByApplicationId: protectedProcedure
		.input(z.object({ applicationId: z.string().min(1) }))
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
			const container = await getServiceContainer(app.appName, app.serverId);
			const mounts = container?.Mounts.filter(
				(mount) => mount.Type === "volume" && mount.Source !== "",
			);
			return mounts;
		}),
});
