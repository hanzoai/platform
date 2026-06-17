/**
 * Visor tRPC Router
 *
 * Proxies cloud instance management operations to the Visor service.
 * Visor provides unified multi-provider VM/instance/cluster management.
 *
 * Auth: Forwards the user's IAM bearer token from the incoming request.
 * Multi-tenancy: Scoped via owner (organizationId from session).
 */

import {
	visorListMachines,
	visorGetMachine,
	visorCreateMachine,
	visorUpdateMachine,
	visorDeleteMachine,
	visorListProviders,
	visorListPlans,
	visorListNodePools,
	visorListVolumes,
	visorCreateVolume,
	visorDeleteVolume,
} from "@hanzo/platform/services/visor";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the Bearer token from the incoming HTTP request.
 * Falls back to cookie-based session token if no Authorization header.
 */
function extractToken(req: { headers: Record<string, string | string[] | undefined> }): string {
	const authHeader = req.headers.authorization;
	if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
		return authHeader.slice(7);
	}
	throw new TRPCError({
		code: "UNAUTHORIZED",
		message: "Missing Bearer token for Visor API proxy",
	});
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const visorRouter = createTRPCRouter({
	// ======================================================================
	// Machines
	// ======================================================================

	listMachines: protectedProcedure.query(async ({ ctx }) => {
		const token = extractToken(ctx.req);
		return visorListMachines(ctx.session.activeOrganizationId, token);
	}),

	getMachine: protectedProcedure
		.input(z.object({ name: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const token = extractToken(ctx.req);
			return visorGetMachine(
				ctx.session.activeOrganizationId,
				input.name,
				token,
			);
		}),

	createMachine: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				provider: z.string().min(1),
				region: z.string().min(1),
				size: z.string().min(1),
				image: z.string().optional(),
				labels: z.record(z.string(), z.string()).optional(),
				userData: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const token = extractToken(ctx.req);
			return visorCreateMachine(
				{
					owner: ctx.session.activeOrganizationId,
					...input,
				},
				token,
			);
		}),

	updateMachine: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				size: z.string().optional(),
				labels: z.record(z.string(), z.string()).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const token = extractToken(ctx.req);
			return visorUpdateMachine(
				{
					owner: ctx.session.activeOrganizationId,
					...input,
				},
				token,
			);
		}),

	deleteMachine: protectedProcedure
		.input(z.object({ name: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const token = extractToken(ctx.req);
			return visorDeleteMachine(
				ctx.session.activeOrganizationId,
				input.name,
				token,
			);
		}),

	// ======================================================================
	// Providers
	// ======================================================================

	listProviders: protectedProcedure.query(async ({ ctx }) => {
		const token = extractToken(ctx.req);
		return visorListProviders(ctx.session.activeOrganizationId, token);
	}),

	// ======================================================================
	// Plans
	// ======================================================================

	listPlans: protectedProcedure.query(async ({ ctx }) => {
		const token = extractToken(ctx.req);
		return visorListPlans(token);
	}),

	// ======================================================================
	// Node Pools
	// ======================================================================

	listNodePools: protectedProcedure.query(async ({ ctx }) => {
		const token = extractToken(ctx.req);
		return visorListNodePools(ctx.session.activeOrganizationId, token);
	}),

	// ======================================================================
	// Volumes
	// ======================================================================

	listVolumes: protectedProcedure.query(async ({ ctx }) => {
		const token = extractToken(ctx.req);
		return visorListVolumes(ctx.session.activeOrganizationId, token);
	}),

	createVolume: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				sizeGb: z.number().int().min(1),
				region: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const token = extractToken(ctx.req);
			return visorCreateVolume(
				{
					owner: ctx.session.activeOrganizationId,
					...input,
				},
				token,
			);
		}),

	deleteVolume: protectedProcedure
		.input(z.object({ name: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const token = extractToken(ctx.req);
			return visorDeleteVolume(
				ctx.session.activeOrganizationId,
				input.name,
				token,
			);
		}),
});
