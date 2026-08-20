/**
 * build-job service — durable CRUD over the platform-native CI/CD job table.
 *
 * The webhook handler enqueues one `buildJob` row per matrix entry. The
 * BuildScheduler transitions rows queued → running → succeeded/failed and
 * appends logs. Everything here is plain Drizzle against the shared db.
 */
import { and, db, eq } from "@hanzo/platform/db";
import {
	type BuildJob,
	buildJob,
	type NewBuildJob,
} from "@hanzo/platform/db/schema";
import { TRPCError } from "@trpc/server";
import { desc } from "drizzle-orm";

export type { BuildJob };

/**
 * Record a build, or hand back the one already recording it.
 *
 * `build_job_identity` makes (repo, sha, target, image) one row, so a caller
 * that loses the race gets no row back from the insert and reads the winner
 * instead. Every caller ends up holding the same build — which is what a caller
 * asking for a build it already asked for means, and the reason a duplicate
 * delivery costs nothing rather than a second cluster build.
 */
export const createBuildJob = async (input: NewBuildJob): Promise<BuildJob> => {
	const row = await db
		.insert(buildJob)
		.values(input)
		.onConflictDoNothing()
		.returning()
		.then((r) => r[0]);
	if (row) return row;

	const winner = await findBuildJobByTarget(
		input.repo,
		input.sha,
		input.target,
		input.image,
	);
	if (!winner) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to create build job",
		});
	}
	return winner;
};

export const findBuildJobById = async (
	buildJobId: string,
): Promise<BuildJob> => {
	const row = await db.query.buildJob.findFirst({
		where: eq(buildJob.buildJobId, buildJobId),
	});
	if (!row) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Build job not found" });
	}
	return row;
};

export const findBuildJobByTarget = async (
	repo: string,
	sha: string,
	target: string,
	/**
	 * Optional fourth key. The webhook path already separates the images of one
	 * commit by putting `build.name` into `target`, so it passes three and keeps
	 * its behaviour. The direct path has no such name and used a bare
	 * `os/arch`, which collapsed EVERY direct build of a commit into one row:
	 * asking to build the same sha as a different image returned the earlier
	 * job and reported the OLD image as the result.
	 *
	 * That is not cosmetic. This repo's Dockerfile has four final stages, so one
	 * commit legitimately yields four images, and a request for the `platform`
	 * stage was answered with an already-built `api` stage. Deploying what the
	 * API called success crash-looped the StatefulSet on MODULE_NOT_FOUND.
	 */
	image?: string,
): Promise<BuildJob | undefined> => {
	return db.query.buildJob.findFirst({
		where: and(
			eq(buildJob.repo, repo),
			eq(buildJob.sha, sha),
			eq(buildJob.target, target),
			...(image ? [eq(buildJob.image, image)] : []),
		),
	});
};

export const listBuildJobs = async (filter: {
	repo?: string;
	sha?: string;
	status?: BuildJob["status"];
	limit?: number;
}): Promise<BuildJob[]> => {
	const clauses = [
		filter.repo ? eq(buildJob.repo, filter.repo) : undefined,
		filter.sha ? eq(buildJob.sha, filter.sha) : undefined,
		filter.status ? eq(buildJob.status, filter.status) : undefined,
	].filter((c): c is NonNullable<typeof c> => c !== undefined);

	return db.query.buildJob.findMany({
		where: clauses.length ? and(...clauses) : undefined,
		orderBy: [desc(buildJob.createdAt)],
		limit: filter.limit ?? 50,
	});
};

export const updateBuildJob = async (
	buildJobId: string,
	patch: Partial<BuildJob>,
): Promise<BuildJob> => {
	const row = await db
		.update(buildJob)
		.set(patch)
		.where(eq(buildJob.buildJobId, buildJobId))
		.returning()
		.then((r) => r[0]);
	if (!row) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Build job not found" });
	}
	return row;
};

/** Append a line to the build job's inline log (MVP storage). */
export const appendBuildLog = async (
	buildJobId: string,
	line: string,
): Promise<void> => {
	const job = await findBuildJobById(buildJobId);
	const stamped = `[${new Date().toISOString()}] ${line}\n`;
	await db
		.update(buildJob)
		.set({ logs: job.logs + stamped })
		.where(eq(buildJob.buildJobId, buildJobId));
};

export const markBuildRunning = async (
	buildJobId: string,
	dispatchId: string,
): Promise<BuildJob> =>
	updateBuildJob(buildJobId, {
		status: "running",
		dispatchId,
		startedAt: new Date().toISOString(),
	});

export const markBuildSucceeded = async (
	buildJobId: string,
): Promise<BuildJob> =>
	updateBuildJob(buildJobId, {
		status: "succeeded",
		finishedAt: new Date().toISOString(),
	});

export const markBuildFailed = async (
	buildJobId: string,
	error: string,
): Promise<BuildJob> =>
	updateBuildJob(buildJobId, {
		status: "failed",
		error,
		finishedAt: new Date().toISOString(),
	});
