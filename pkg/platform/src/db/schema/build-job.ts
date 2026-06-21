import { relations } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";

/**
 * build-job — system of record for platform-native CI/CD.
 *
 * The GHA billing-freeze incident proved GitHub Actions is a single point
 * of failure. Platform now owns the build+deploy lifecycle: a GitHub webhook
 * (or manual trigger) records a `buildJob`, the BuildScheduler dispatches it
 * to the self-hosted arcd runner pools, and the DeployExecutor rolls the
 * resulting image onto the target cluster via the hanzo operator.
 *
 * This table is the durable source of truth for "what is being built/deployed
 * and why" — independent of GitHub's own run history.
 */

export const buildJob = sqliteTable("build_job", {
	buildJobId: text("buildJobId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	/** `owner/repo` — the source repository. */
	repo: text("repo").notNull(),
	/** Full commit SHA that triggered the build. */
	sha: text("sha").notNull(),
	/** Git ref (e.g. `refs/heads/main`) the SHA belongs to. */
	ref: text("ref").notNull(),
	/** Short branch name extracted from ref (e.g. `main`). */
	branch: text("branch").notNull(),
	/**
	 * Build matrix target key, e.g. `linux/amd64`. One buildJob row per
	 * matrix entry — keyed uniquely by (repo, sha, target) at enqueue time.
	 */
	target: text("target").notNull(),
	/** arcd pool label this target dispatches to, e.g. `hanzoai-linux-amd64`. */
	runnerPool: text("runnerPool").notNull(),
	/** Fully-resolved image reference being built, e.g. `ghcr.io/hanzoai/zip:<sha>`. */
	image: text("image").notNull(),
	status: text("status", {
		enum: ["queued", "running", "succeeded", "failed", "cancelled"],
	})
		.notNull()
		.default("queued"),
	/**
	 * Identifier returned by the build dispatch (GitHub workflow run id when
	 * dispatched via workflow_dispatch). Used to correlate completion.
	 */
	dispatchId: text("dispatchId"),
	/** Append-only build log (MVP: stored inline; large logs move to object storage). */
	logs: text("logs").notNull().default(""),
	/** Human-readable failure reason when status=failed. */
	error: text("error"),
	/** Rollout state once a successful build hands off to the DeployExecutor. */
	rolloutStatus: text("rolloutStatus", {
		enum: ["pending", "applied", "running", "failed", "skipped"],
	})
		.notNull()
		.default("skipped"),
	/** Name of the operator CR the rollout targeted (kind=Service). */
	rolloutTarget: text("rolloutTarget"),
	attempt: integer("attempt").notNull().default(0),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	startedAt: text("startedAt"),
	finishedAt: text("finishedAt"),
	organizationId: text("organizationId")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
});

export const buildJobRelations = relations(buildJob, ({ one }) => ({
	organization: one(organization, {
		fields: [buildJob.organizationId],
		references: [organization.id],
	}),
}));

const createSchema = createInsertSchema(buildJob, {
	repo: z.string().min(1),
	sha: z.string().min(7),
	ref: z.string().min(1),
	branch: z.string().min(1),
	target: z.string().min(1),
	runnerPool: z.string().min(1),
	image: z.string().min(1),
	organizationId: z.string().min(1),
});

export const apiCreateBuildJob = createSchema.pick({
	repo: true,
	sha: true,
	ref: true,
	branch: true,
	target: true,
	runnerPool: true,
	image: true,
	organizationId: true,
});

export const apiFindBuildJob = z.object({
	buildJobId: z.string().min(1),
});

export const apiListBuildJobs = z.object({
	repo: z.string().optional(),
	sha: z.string().optional(),
	status: z
		.enum(["queued", "running", "succeeded", "failed", "cancelled"])
		.optional(),
	limit: z.number().int().positive().max(200).optional(),
});

export type BuildJob = typeof buildJob.$inferSelect;
export type NewBuildJob = typeof buildJob.$inferInsert;
