import {
	getGatewayStatus,
	listRateLimitRules,
	createRateLimitRule,
	updateRateLimitRule,
	deleteRateLimitRule,
	listRoutingRules,
	createRoutingRule,
	updateRoutingRule,
	deleteRoutingRule,
} from "@hanzo/platform/services/gateway";
import {
	apiCreateRateLimitRule,
	apiUpdateRateLimitRule,
	apiFindRateLimitRule,
	apiCreateRoutingRule,
	apiUpdateRoutingRule,
	apiFindRoutingRule,
} from "@hanzo/platform/db/schema";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure } from "@/server/api/trpc";

export const gatewayRouter = createTRPCRouter({
	status: adminProcedure.query(async () => {
		try {
			return await getGatewayStatus();
		} catch (error) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message:
					error instanceof Error
						? error.message
						: "Failed to fetch gateway status",
				cause: error,
			});
		}
	}),

	listRateLimits: adminProcedure.query(async () => {
		try {
			return await listRateLimitRules();
		} catch (error) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message:
					error instanceof Error
						? error.message
						: "Failed to list rate limit rules",
				cause: error,
			});
		}
	}),

	createRateLimit: adminProcedure
		.input(apiCreateRateLimitRule)
		.mutation(async ({ input }) => {
			try {
				return await createRateLimitRule(input);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Failed to create rate limit rule",
					cause: error,
				});
			}
		}),

	updateRateLimit: adminProcedure
		.input(apiUpdateRateLimitRule)
		.mutation(async ({ input }) => {
			try {
				return await updateRateLimitRule(input);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Failed to update rate limit rule",
					cause: error,
				});
			}
		}),

	deleteRateLimit: adminProcedure
		.input(apiFindRateLimitRule)
		.mutation(async ({ input }) => {
			try {
				return await deleteRateLimitRule(input.rateLimitRuleId);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Failed to delete rate limit rule",
					cause: error,
				});
			}
		}),

	listRoutes: adminProcedure.query(async () => {
		try {
			return await listRoutingRules();
		} catch (error) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message:
					error instanceof Error
						? error.message
						: "Failed to list routing rules",
				cause: error,
			});
		}
	}),

	createRoute: adminProcedure
		.input(apiCreateRoutingRule)
		.mutation(async ({ input }) => {
			try {
				return await createRoutingRule(input);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Failed to create routing rule",
					cause: error,
				});
			}
		}),

	updateRoute: adminProcedure
		.input(apiUpdateRoutingRule)
		.mutation(async ({ input }) => {
			try {
				return await updateRoutingRule(input);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Failed to update routing rule",
					cause: error,
				});
			}
		}),

	deleteRoute: adminProcedure
		.input(apiFindRoutingRule)
		.mutation(async ({ input }) => {
			try {
				return await deleteRoutingRule(input.routingRuleId);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Failed to delete routing rule",
					cause: error,
				});
			}
		}),
});
