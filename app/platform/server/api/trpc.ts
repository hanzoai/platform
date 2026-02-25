/**
 * TRPC API SETUP WITH REAL AUTHENTICATION
 */

import { validateRequest } from "@hanzo/platform/lib/auth";
import { initTRPC, TRPCError } from "@trpc/server";

/**
 * Local OpenApiMeta type definition.
 *
 * @hanzo/trpc-openapi v0.0.4 imports from @trpc/server v10 internal paths
 * (e.g. @trpc/server/dist/core/internals/config) which don't exist in v11.
 * Using the package's OpenApiMeta type breaks the initTRPC type chain,
 * causing the transformer flag to be inferred as `false`.
 *
 * We define a structurally compatible type here to preserve both:
 * - Runtime compatibility with @hanzo/trpc-openapi (it only checks the shape)
 * - Correct type inference for the transformer flag in tRPC v11
 */
interface OpenApiMeta {
	openapi?: {
		override?: boolean;
		additional?: boolean;
		enabled?: boolean;
		method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
		path: `/${string}`;
		summary?: string;
		description?: string;
		protect?: boolean;
		tags?: string[];
		contentTypes?: string[];
		deprecated?: boolean;
		example?: {
			request?: Record<string, any>;
			response?: Record<string, any>;
		};
	};
}
import type { CreateNextContextOptions } from "@trpc/server/adapters/next";
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
 *
 * In tRPC v11, CreateNextContextOptions includes an `info` field.
 * We destructure only what we need for backwards-compatible context creation.
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
 * Upload procedure middleware
 *
 * In tRPC v11, the experimental form-data utilities from
 * @trpc/server/adapters/node-http/content-type/form-data are removed.
 * Instead we parse multipart form data manually using Node.js built-in APIs.
 *
 * This middleware checks the Content-Type header and parses multipart/form-data
 * requests into a FormData-like object, then passes it as rawInput.
 */
export const uploadProcedure = async (opts: any) => {
	const req = opts.ctx.req;
	const contentType = req.headers?.["content-type"] || "";

	if (!contentType.includes("multipart/form-data")) {
		return opts.next();
	}

	// Parse multipart form data from the raw request
	const formData = await parseMultipartRequest(req, {
		maxFileSize: 1024 * 1024 * 1024 * 2, // 2GB
	});

	return opts.next({
		rawInput: formData,
	});
};

/**
 * Parse a multipart/form-data request into a FormData object.
 * Uses a simple boundary-based parser without external dependencies.
 */
async function parseMultipartRequest(
	req: any,
	options: { maxFileSize: number },
): Promise<FormData> {
	const contentType: string = req.headers?.["content-type"] || "";
	const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
	if (!boundaryMatch) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Missing boundary in multipart/form-data",
		});
	}
	const boundary = boundaryMatch[1] || boundaryMatch[2];

	return new Promise<FormData>((resolve, reject) => {
		const chunks: Buffer[] = [];
		let totalSize = 0;

		req.on("data", (chunk: Buffer) => {
			totalSize += chunk.length;
			if (totalSize > options.maxFileSize) {
				req.destroy();
				reject(
					new TRPCError({
						code: "PAYLOAD_TOO_LARGE",
						message: `Upload exceeds max size of ${options.maxFileSize} bytes`,
					}),
				);
				return;
			}
			chunks.push(chunk);
		});

		req.on("error", (err: Error) => reject(err));

		req.on("end", () => {
			try {
				const buffer = Buffer.concat(chunks);
				const formData = parseMultipartBuffer(buffer, boundary);
				resolve(formData);
			} catch (err) {
				reject(err);
			}
		});
	});
}

/**
 * Parse a multipart buffer into a FormData object.
 */
function parseMultipartBuffer(buffer: Buffer, boundary: string): FormData {
	const formData = new FormData();
	const boundaryBuffer = Buffer.from(`--${boundary}`);
	const endBoundaryBuffer = Buffer.from(`--${boundary}--`);

	// Split buffer by boundary
	let start = 0;
	const parts: Buffer[] = [];

	while (start < buffer.length) {
		const idx = buffer.indexOf(boundaryBuffer, start);
		if (idx === -1) break;

		if (parts.length > 0) {
			// The content between previous boundary end and this boundary start
			// Remove leading \r\n and trailing \r\n
			let partStart = start;
			let partEnd = idx;
			if (buffer[partStart] === 0x0d && buffer[partStart + 1] === 0x0a) {
				partStart += 2;
			}
			if (partEnd >= 2 && buffer[partEnd - 2] === 0x0d && buffer[partEnd - 1] === 0x0a) {
				partEnd -= 2;
			}
			if (partEnd > partStart) {
				parts.push(buffer.subarray(partStart, partEnd));
			}
		}

		start = idx + boundaryBuffer.length;

		// Check for end boundary
		if (
			buffer[start] === 0x2d &&
			buffer[start + 1] === 0x2d
		) {
			break;
		}
	}

	for (const part of parts) {
		// Split headers from body at \r\n\r\n
		const headerEndIdx = part.indexOf("\r\n\r\n");
		if (headerEndIdx === -1) continue;

		const headerSection = part.subarray(0, headerEndIdx).toString("utf-8");
		const body = part.subarray(headerEndIdx + 4);

		// Parse Content-Disposition
		const dispositionMatch = headerSection.match(
			/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i,
		);
		if (!dispositionMatch) continue;

		const name = dispositionMatch[1];
		const filename = dispositionMatch[2];

		if (filename !== undefined) {
			// File field - detect content type
			const ctMatch = headerSection.match(/Content-Type:\s*([^\r\n]+)/i);
			const mimeType = ctMatch ? ctMatch[1].trim() : "application/octet-stream";
			const file = new File([body], filename, { type: mimeType });
			formData.append(name, file);
		} else {
			// Text field
			formData.append(name, body.toString("utf-8"));
		}
	}

	return formData;
}

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
