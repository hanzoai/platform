-- The board observes the whole FLEET — hanzo, lux and zoo, across every cluster
-- the deployer delivers to — not just the one cluster platform happens to run in.
-- Three consequences for this table.
--
-- 1. IDENTITY. `<org>/<app>/<env>` was unique only by accident of a single
--    cluster that runs one namespace per env. Across the fleet it collides: the
--    release `cloud` exists in `hanzo`, `lux-cloud` AND `zoo-cloud`, all env
--    `main`, all different images. The honest identity of a deployed thing is
--    WHERE IT RUNS — `<cluster>/<namespace>/<app>` — which is unique by
--    Kubernetes construction, so the primary key alone carries it and the old
--    `apps_unique` index is gone (one identity, one mechanism).
--
-- 2. UNOBSERVABLE IS NOT EMPTY. `repo`/`registry` were NOT NULL, which forces an
--    invented value for an app whose image the readers cannot see. They are now
--    nullable and render as "unknown".
--
-- 3. The deployer knows two things nobody else does: whether the live objects
--    still match git, and which revision it last reconciled to. `sync_status`
--    (our vocabulary: synced | drifted | unknown) and `sync_revision`.
--
-- The table records OBSERVATION, never a system of record — the readers rebuild
-- every row from the cluster each pass — so the rebuild starts empty and is
-- repopulated within one interval.
DROP TABLE `apps`;
--> statement-breakpoint
CREATE TABLE `apps` (
	`id` text PRIMARY KEY NOT NULL,
	`org` text NOT NULL,
	`app` text NOT NULL,
	`env` text NOT NULL,
	`repo` text,
	`registry` text,
	`declared_tag` text,
	`running_tag` text,
	`latest_tag` text,
	`release_url` text,
	`release_assets` integer DEFAULT 0 NOT NULL,
	`health` text,
	`sync_status` text,
	`sync_revision` text,
	`last_observed` integer,
	`cluster` text,
	`namespace` text,
	`hosts` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`organizationId` text,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
