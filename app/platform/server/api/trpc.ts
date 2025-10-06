/**
 * TRPC API SETUP WITH REAL AUTHENTICATION
 */

import { validateRequest } from "@hanzo/platform/lib/auth";
import type { OpenApiMeta } from "@hanzo/trpc-openapi";
import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateNextContextOptions } from "@trpc/server/adapters/next";
import {
	experimental_createMemoryUploadHandler,
	experimental_isMultipartFormDataRequest,
	experimental_parseMultipartFormData,
} from "@trpc/server/adapters/node-http/content-type/form-data";
import type { Session, User } from "better-auth";
import superjson from "superjson";
import { ZodError } from "zod";
import { db } from "@/server/db";

/**
 * CONTEXT
 */

interface CreateContextOptions {
	user: (User & { role: "member" | "admin" | "owner"; ownerId: string }) | null;
	session:
		| (Session & { activeOrganizationId: string; impersonatedBy?: string })
		| null;
	req: CreateNextContextOptions["req"];
	res: CreateNextContextOptions["res"];
}

const createInnerTRPCContext = (opts: CreateContextOptions) => {
	return {
		session: opts.session,
		db,
		req: opts.req,
		res: opts.res,
		user: opts.user,
	};
};

/**
 * Create TRPC context with real authentication
 */
export const createTRPCContext = async (opts: CreateNextContextOptions) => {
	const { req, res } = opts;

	// Get real session from better-auth
	const { session, user } = await validateRequest(req);

	return createInnerTRPCContext({
		req,
		res,
		// @ts-ignore
		session: session
			? {
					...session,
					activeOrganizationId: session.activeOrganizationId || "",
				}
			: null,
		// @ts-ignore
		user: user
			? {
					...user,
					email: user.email,
					role: user.role as "owner" | "member" | "admin",
					id: user.id,
					ownerId: user.ownerId,
				}
			: null,
	});
};

/**
 * INITIALIZATION
 */

const t = initTRPC
	.meta<OpenApiMeta>()
	.context<typeof createTRPCContext>()
	.create({
		transformer: superjson,
		errorFormatter({ shape, error }) {
			return {
				...shape,
				data: {
					...shape.data,
					zodError:
						error.cause instanceof ZodError ? error.cause.flatten() : null,
				},
			};
		},
	});

/**
 * Create router
 */
export const createTRPCRouter = t.router;

/**
 * Public procedure - no authentication required
 */
export const publicProcedure = t.procedure;

/**
 * Protected procedure - requires authentication
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.session || !ctx.user) {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}

	return next({
		ctx: {
			// infers the `session` and `user` as non-nullable
			session: ctx.session,
			user: ctx.user,
		},
	});
});

/**
 * Upload procedure
 */
export const uploadProcedure = async (opts: any) => {
	if (!experimental_isMultipartFormDataRequest(opts.ctx.req)) {
		return opts.next();
	}

	const formData = await experimental_parseMultipartFormData(
		opts.ctx.req,
		experimental_createMemoryUploadHandler({
			// 2GB
			maxPartSize: 1024 * 1024 * 1024 * 2,
		}),
	);

	return opts.next({
		rawInput: formData,
	});
};

/**
 * CLI procedure - requires valid API key (admin only)
 */
export const cliProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.user || ctx.user.role !== "owner") {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}

	return next({
		ctx: {
			session: ctx.session,
			user: ctx.user,
		},
	});
});

/**
 * Admin procedure - requires admin or owner role
 */
export const adminProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.session || !ctx.user) {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}

	if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
		throw new TRPCError({ code: "FORBIDDEN" });
	}

	return next({
		ctx: {
			session: ctx.session,
			user: ctx.user,
		},
	});
});
