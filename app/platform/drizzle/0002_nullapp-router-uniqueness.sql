DROP INDEX `domain_unique_config_key_per_app`;--> statement-breakpoint
CREATE UNIQUE INDEX `domain_unique_config_key_per_compose` ON `domain` (`composeId`,`uniqueConfigKey`) WHERE "domain"."composeId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `domain_unique_config_key_per_preview` ON `domain` (`previewDeploymentId`,`uniqueConfigKey`) WHERE "domain"."previewDeploymentId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `domain_unique_config_key_per_app` ON `domain` (`applicationId`,`uniqueConfigKey`) WHERE "domain"."applicationId" IS NOT NULL;