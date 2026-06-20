import { z } from "zod";

export const jobQueueSchema = z.discriminatedUnion("type", [
	z.object({
		cronSchedule: z.string(),
		type: z.literal("backup"),
		backupId: z.string(),
	}),
	z.object({
		cronSchedule: z.string(),
		type: z.literal("server"),
		serverId: z.string(),
	}),
	z.object({
		cronSchedule: z.string(),
		type: z.literal("schedule"),
		scheduleId: z.string(),
		timezone: z.string().optional(),
	}),
	z.object({
		cronSchedule: z.string(),
		type: z.literal("volume-backup"),
		volumeBackupId: z.string(),
	}),
	// apps-lifecycle readers (PR 2 of docs/APPS_LIFECYCLE.md). Each is a
	// singleton repeatable job on its own cron; the discriminator carries no
	// id because each reader sweeps the whole apps table. The job name is the
	// type itself (see queue.ts), so there is exactly one of each.
	z.object({
		cronSchedule: z.string(),
		type: z.literal("read-latest-tag"),
	}),
	z.object({
		cronSchedule: z.string(),
		type: z.literal("read-declared-tag"),
	}),
	z.object({
		cronSchedule: z.string(),
		type: z.literal("read-running-tag"),
	}),
	z.object({
		cronSchedule: z.string(),
		type: z.literal("read-release-meta"),
	}),
]);

/** The four apps-lifecycle reader job types — used to register/dispatch them
 *  generically without re-listing the literals. */
export const APPS_READER_TYPES = [
	"read-latest-tag",
	"read-declared-tag",
	"read-running-tag",
	"read-release-meta",
] as const;

export type AppsReaderType = (typeof APPS_READER_TYPES)[number];

export type QueueJob = z.infer<typeof jobQueueSchema>;
