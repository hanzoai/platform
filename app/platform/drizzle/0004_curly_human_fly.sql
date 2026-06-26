ALTER TABLE `doks_cluster` ADD `phase` text DEFAULT 'requested' NOT NULL;--> statement-breakpoint
ALTER TABLE `doks_cluster` ADD `operatorInstalled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `doks_cluster` ADD `baselineInstalled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `doks_cluster` ADD `active` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `doks_cluster` ADD `baselineError` text;