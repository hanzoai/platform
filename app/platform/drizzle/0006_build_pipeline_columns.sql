DROP TABLE `arcd_runner`;--> statement-breakpoint
ALTER TABLE `build_job` ADD `buildJobName` text;--> statement-breakpoint
ALTER TABLE `build_job` ADD `imageDigest` text;--> statement-breakpoint
ALTER TABLE `build_job` ADD `e2eJobName` text;--> statement-breakpoint
ALTER TABLE `build_job` ADD `e2eStatus` text;--> statement-breakpoint
ALTER TABLE `build_job` ADD `publishJobName` text;--> statement-breakpoint
ALTER TABLE `build_job` ADD `publishStatus` text;--> statement-breakpoint
ALTER TABLE `build_job` ADD `publishSpec` text;