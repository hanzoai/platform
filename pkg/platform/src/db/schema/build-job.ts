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
	 * Identifier returned by the build dispatch. The single dispatch path is the
	 * in-cluster BuildKit Job (`buildkit:<jobName>`); platform builds on its own
	 * cluster, never via GitHub Actions. Used to correlate completion.
	 */
	dispatchId: text("dispatchId"),
	/**
	 * Name of the in-cluster BuildKit build Job that builds + pushes this image.
	 * The build-watcher reads this Job's status to advance the row.
	 */
	buildJobName: text("buildJobName"),
	/**
	 * Image digest (`sha256:…`) this build pushed — which BYTES it produced, as
	 * opposed to the tag it produced them under. Read from the BuildKit log by
	 * `parseImageDigest`, or reported by an external builder via
	 * /v1/build-callback. Null when the log was unreadable; never guessed.
	 */
	imageDigest: text("imageDigest"),
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
	/** Name of the in-cluster Playwright e2e Job fired after a successful deploy. */
	e2eJobName: text("e2eJobName"),
	/**
	 * End-to-end test outcome. `queued` while the Job runs; `passed`/`failed`
	 * once it terminates; `skipped` when the repo declares no `e2e:` block or
	 * the build did not deploy. Null until the build succeeds.
	 */
	e2eStatus: text("e2eStatus", {
		enum: ["queued", "passed", "failed", "skipped"],
	}),
	/** Name of the in-cluster publish Job (npm/pypi) for library/SDK repos. */
	publishJobName: text("publishJobName"),
	/**
	 * Publish outcome. `pending` = waiting on e2e to pass before publishing;
	 * `queued` = publish Job launched; `published`/`failed` once it terminates;
	 * `skipped` when the repo declares no `publish:` block. Null until success.
	 */
	publishStatus: text("publishStatus", {
		enum: ["pending", "queued", "published", "failed", "skipped"],
	}),
	/** Resolved `publish:` config (JSON) captured at build success, so the e2e→publish handoff needs no re-fetch. */
	publishSpec: text("publishSpec"),
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
