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
				installationId: z.string().min(1),
				repo: z.string().min(3),
				sha: z.string().min(7),
				ref: z.string().min(1),
				branch: z.string().min(1),
			}),
		)
		.mutation(async ({ input }) => {
			const result = await scheduleBuilds(input);
			if (!result) {
				return {
					scheduled: 0,
					message: `${input.repo} has no .platform.yml`,
				};
			}
			return {
				scheduled: result.jobs.length,
				buildJobIds: result.jobs.map((j) => j.buildJobId),
			};
		}),
});
