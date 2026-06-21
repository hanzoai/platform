CREATE TABLE `apps` (
	`id` text PRIMARY KEY NOT NULL,
	`org` text NOT NULL,
	`app` text NOT NULL,
	`env` text NOT NULL,
	`repo` text NOT NULL,
	`registry` text NOT NULL,
	`declared_tag` text,
	`running_tag` text,
	`latest_tag` text,
	`release_url` text,
	`release_assets` integer DEFAULT 0 NOT NULL,
	`health` text,
	`last_observed` integer,
	`cluster` text,
	`namespace` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`organizationId` text,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apps_unique` ON `apps` (`org`,`app`,`env`);