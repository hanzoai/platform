/**
 * build-job router — read access + manual trigger for platform-native CI/CD.
 *
 * All queries are scoped to the caller's active organization. The buildJob
 * table is the system-of-record for "what is being built/deployed and why",
 * independent of GitHub's own run history.
 */

import { apiFindBuildJob, apiListBuildJobs } from "@hanzo/platform/db/schema";
import {
	findBuildJobById,
	listBuildJobs,
	scheduleBuilds,
} from "@hanzo/platform/services/ci";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";

function assertOrg(orgOnRow: string, activeOrg: string | null | undefined) {
	if (!activeOrg || orgOnRow !== activeOrg) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "Build job belongs to a different organization",
		});
	}
}

export const buildJobRouter = createTRPCRouter({
	list: protectedProcedure
		.input(apiListBuildJobs)
		.query(async ({ input, ctx }) => {
			const jobs = await listBuildJobs(input);
			return jobs.filter(
				(j) => j.organizationId === ctx.session.activeOrganizationId,
			);
		}),

	one: protectedProcedure
		.input(apiFindBuildJob)
		.query(async ({ input, ctx }) => {
			const job = await findBuildJobById(input.buildJobId);
			assertOrg(job.organizationId, ctx.session.activeOrganizationId);
			return job;
		}),

	logs: protectedProcedure
		.input(apiFindBuildJob)
		.query(async ({ input, ctx }) => {
			const job = await findBuildJobById(input.buildJobId);
			assertOrg(job.organizationId, ctx.session.activeOrganizationId);
			return { logs: job.logs };
		}),

	trigger: protectedProcedure
		.input(
			z.object({
				// TWO values, and they are the two a person means: which repository,
				// and which branch or tag of it. What each one IS is settled in
				// `scheduleBuilds`, through `repoProblem`/`refProblem` — restating a
				// shape here would be a second answer to a question that has one.
				//
				// No commit and no forge. The forge holds this repository and says
				// what the ref points at; both follow from what is here, so neither
				// is a field a caller could fill with something that does not.
				repo: z.string(),
				ref: z.string(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			// The org a build acts as follows the repository, and a repository is
			// caller input — so state the org the caller may act as, exactly as
			// `one`/`logs` do with assertOrg. Without it any authenticated user
			// could build and deploy as another organization.
			const result = await scheduleBuilds({
				...input,
				source: { forge: "hanzo-git" },
				requireOrganizationId: ctx.session.activeOrganizationId,
			});
			// The scheduler decided WHY nothing was built and says it in one
			// sentence — the same one the forge's delivery history shows.
			if ("declined" in result) {
				return { scheduled: 0, message: result.why };
			}
			return {
				scheduled: result.jobs.length,
				buildJobIds: result.jobs.map((j) => j.buildJobId),
			};
		}),
});
