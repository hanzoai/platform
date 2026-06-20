import { findApps } from "@hanzo/platform";
import { apiListApps } from "@/server/db/schema";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * apps router — the read API behind the drift view at `platform.hanzo.ai/apps`.
 *
 * Contract: `docs/APPS_LIFECYCLE.md` §6. Thin transport over the single
 * `findApps` data path (`@hanzo/platform`): the in-app page consumes `apps.all`
 * for end-to-end type safety, and the same procedure is surfaced as the REST
 * `GET /api/apps` via the openapi meta (the canonical `/v1/apps` path is the
 * thin handler at `pages/api/v1/apps.ts`, which delegates to the very same
 * function — one query, never two implementations).
 *
 * Rows are scoped to the caller's active organization plus the shared
 * control-plane rows. This router only reads; the cron readers (PR 2) own the
 * observed columns.
 */
export const appsRouter = createTRPCRouter({
	all: protectedProcedure
		.meta({
			openapi: {
				path: "/apps",
				method: "GET",
				description:
					"List the apps-lifecycle rows (declared/running/latest tags + " +
					"derived drift) for the active organization. Filter by org/env/health.",
			},
		})
		.input(apiListApps)
		.query(async ({ input, ctx }) => {
			return findApps(ctx.session.activeOrganizationId, input);
		}),
});
