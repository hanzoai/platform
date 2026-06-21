import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * arcd-runner — registry of self-hosted arcd runners that pull build jobs over
 * the native long-poll protocol (POST /v1/arcd/poll + /v1/arcd/complete),
 * instead of GitHub's `workflow_dispatch`.
 *
 * Each row is one runner process on one box (e.g. `evo-1` serving the
 * `hanzoai-linux-amd64` pool). A runner self-registers by being provisioned
 * with a row here; its `secret` is the shared key used to HMAC every poll and
 * complete request body. Registration is the migration switch: once a runner
 * for pool P has a row AND has reported a `lastSeen` within the staleness
 * window, the BuildScheduler stops dispatching pool-P jobs via
 * `workflow_dispatch` and enqueues them onto the native queue instead.
 *
 * The `secret` is the runner's HMAC key, NOT a user password — it is a
 * machine-to-machine credential, stored as the raw shared secret because both
 * sides must compute the SAME HMAC over the request body (a one-way hash would
 * make verification impossible). It is high-entropy, per-runner, and rotated
 * by replacing the row; it never authenticates a human.
 */
export const arcdRunner = sqliteTable("arcd_runner", {
	/** Stable runner id, e.g. `evo-1`. Carried in the poll body and HMAC header. */
	runnerId: text("runnerId").notNull().primaryKey(),
	/** arcd pool this runner serves, e.g. `hanzoai-linux-amd64`. */
	poolLabel: text("poolLabel").notNull(),
	/**
	 * Shared HMAC-SHA256 secret. Machine credential (see file header) — both
	 * platform and the runner hold the identical bytes to sign/verify bodies.
	 */
	secret: text("secret").notNull(),
	/** ISO timestamp of the last successful poll/complete from this runner. */
	lastSeen: text("lastSeen"),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

const createSchema = createInsertSchema(arcdRunner, {
	runnerId: z.string().min(1),
	poolLabel: z.string().min(1),
	secret: z.string().min(32),
});

export const apiRegisterArcdRunner = createSchema.pick({
	runnerId: true,
	poolLabel: true,
	secret: true,
});

export type ArcdRunner = typeof arcdRunner.$inferSelect;
export type NewArcdRunner = typeof arcdRunner.$inferInsert;
