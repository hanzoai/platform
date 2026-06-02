/**
 * Brand-scoped notify provider override (Plivo).
 *
 * Surface for the per-brand "SMS/Email Provider Override" settings page.
 * The actual credentials live in KMS at
 *   `kms.hanzo.ai → brand/<slug>/plivo/{auth-id, auth-token, sender-id, from-email}`.
 *
 * This router is a thin proxy: the platform UI never touches KMS
 * directly. It POSTs to notify's `/v1/notify/brand/plivo` endpoint with
 * the user's IAM JWT, and notify is the only process that holds a KMS
 * token. That keeps secrets out of every other surface.
 *
 * Per CLAUDE.md:
 *   - Default is liquidity's KMS keys until a brand overrides.
 *   - No PostgreSQL — state lives in KMS, not the platform DB.
 *   - X-Org-Id is set from the active organization slug.
 *   - One way to do it; this router is the only path.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, createTRPCRouter } from "@/server/api/trpc";

// NOTIFY_BASE_URL points at the notify service. In dev:
//   http://notify.hanzo.svc.cluster.local:8080
// In prod: https://notify.hanzo.ai
const NOTIFY_BASE_URL =
	process.env.NOTIFY_BASE_URL ?? "http://notify.hanzo.svc.cluster.local:8080";

// Surface for the form. from-email is optional; the rest are required
// when a brand wants to override.
const plivoConfigInput = z.object({
	authId: z.string().min(1, "Auth ID is required"),
	authToken: z.string().min(1, "Auth Token is required"),
	senderId: z.string().min(1, "Sender ID is required (E.164 or Plivo Powerpack UUID)"),
	fromEmail: z.string().email().optional().or(z.literal("")),
});

const testInput = z.object({
	channel: z.enum(["sms", "email"]),
	recipient: z.string().min(1),
});

type PlivoConfigOut = {
	brand: string;
	hasOverride: boolean;
	effectiveBrand: string; // either brand or "liquidity"
	senderId?: string;
	fromEmail?: string;
	// Never returned: authId, authToken — secrets stay in KMS.
};

async function notifyFetch(
	path: string,
	opts: RequestInit & { orgId: string; token?: string },
) {
	const url = `${NOTIFY_BASE_URL}${path}`;
	const headers = new Headers(opts.headers ?? {});
	headers.set("X-Org-Id", opts.orgId);
	headers.set("Content-Type", "application/json");
	if (opts.token) {
		headers.set("Authorization", `Bearer ${opts.token}`);
	}
	const res = await fetch(url, {
		...opts,
		headers,
	});
	if (!res.ok) {
		const text = await res.text();
		throw new TRPCError({
			code: res.status === 401 ? "UNAUTHORIZED" : "INTERNAL_SERVER_ERROR",
			message: `notify ${path} → ${res.status}: ${text}`,
		});
	}
	return res.json();
}

export const notifyProviderRouter = createTRPCRouter({
	/**
	 * Returns the brand's effective Plivo config. NEVER returns the
	 * raw credentials — only metadata so the UI can render "currently
	 * using brand X's Plivo" or "falling back to Liquidity default".
	 */
	get: adminProcedure.query(async ({ ctx }): Promise<PlivoConfigOut> => {
		const orgId = ctx.session.activeOrganizationId;
		if (!orgId) {
			throw new TRPCError({
				code: "UNAUTHORIZED",
				message: "No active organization",
			});
		}
		const data = (await notifyFetch("/v1/notify/brand/plivo", {
			method: "GET",
			orgId,
		})) as PlivoConfigOut;
		return data;
	}),

	/**
	 * Stores brand override creds in KMS via notify. Idempotent;
	 * re-POST replaces.
	 */
	set: adminProcedure
		.input(plivoConfigInput)
		.mutation(async ({ ctx, input }) => {
			const orgId = ctx.session.activeOrganizationId;
			if (!orgId) {
				throw new TRPCError({
					code: "UNAUTHORIZED",
					message: "No active organization",
				});
			}
			await notifyFetch("/v1/notify/brand/plivo", {
				method: "PUT",
				orgId,
				body: JSON.stringify({
					auth_id: input.authId,
					auth_token: input.authToken,
					sender_id: input.senderId,
					from_email: input.fromEmail ?? "",
				}),
			});
			return { ok: true };
		}),

	/**
	 * Removes brand override — subsequent sends fall back to the
	 * Liquidity default.
	 */
	clear: adminProcedure.mutation(async ({ ctx }) => {
		const orgId = ctx.session.activeOrganizationId;
		if (!orgId) {
			throw new TRPCError({
				code: "UNAUTHORIZED",
				message: "No active organization",
			});
		}
		await notifyFetch("/v1/notify/brand/plivo", {
			method: "DELETE",
			orgId,
		});
		return { ok: true };
	}),

	/**
	 * Sends a test SMS / email to the supplied recipient using whatever
	 * config (override or Liquidity default) is currently effective.
	 */
	test: adminProcedure.input(testInput).mutation(async ({ ctx, input }) => {
		const orgId = ctx.session.activeOrganizationId;
		if (!orgId) {
			throw new TRPCError({
				code: "UNAUTHORIZED",
				message: "No active organization",
			});
		}
		const res = (await notifyFetch("/v1/notify/brand/plivo/test", {
			method: "POST",
			orgId,
			body: JSON.stringify({
				channel: input.channel,
				recipient: input.recipient,
			}),
		})) as { status: string; message_id?: string; error?: string };
		if (res.status === "failed") {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: res.error ?? "test send failed",
			});
		}
		return res;
	}),
});
