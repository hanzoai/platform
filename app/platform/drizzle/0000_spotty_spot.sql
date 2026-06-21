CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`is2FAEnabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`resetPasswordToken` text,
	`resetPasswordExpiresAt` text,
	`confirmationToken` text,
	`confirmationExpiresAt` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `apikey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`start` text,
	`prefix` text,
	`key` text NOT NULL,
	`user_id` text NOT NULL,
	`refill_interval` integer,
	`refill_amount` integer,
	`last_refill_at` integer,
	`enabled` integer,
	`rate_limit_enabled` integer,
	`rate_limit_time_window` integer,
	`rate_limit_max` integer,
	`request_count` integer,
	`remaining` integer,
	`last_request` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`permissions` text,
	`metadata` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	`inviter_id` text NOT NULL,
	`team_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`team_id` text,
	`is_default` integer DEFAULT false NOT NULL,
	`canCreateProjects` integer DEFAULT false NOT NULL,
	`canAccessToSSHKeys` integer DEFAULT false NOT NULL,
	`canCreateServices` integer DEFAULT false NOT NULL,
	`canDeleteProjects` integer DEFAULT false NOT NULL,
	`canDeleteServices` integer DEFAULT false NOT NULL,
	`canAccessToDocker` integer DEFAULT false NOT NULL,
	`canAccessToAPI` integer DEFAULT false NOT NULL,
	`canAccessToGitProviders` integer DEFAULT false NOT NULL,
	`canAccessToTraefikFiles` integer DEFAULT false NOT NULL,
	`canDeleteEnvironments` integer DEFAULT false NOT NULL,
	`canCreateEnvironments` integer DEFAULT false NOT NULL,
	`accesedProjects` text DEFAULT '[]' NOT NULL,
	`accessedEnvironments` text DEFAULT '[]' NOT NULL,
	`accesedServices` text DEFAULT '[]' NOT NULL,
	`accessedGitProviders` text DEFAULT '[]' NOT NULL,
	`accessedServers` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text,
	`logo` text,
	`created_at` integer NOT NULL,
	`metadata` text,
	`owner_id` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `organization_role` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`role` text NOT NULL,
	`permission` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `organizationRole_organizationId_idx` ON `organization_role` (`organization_id`);--> statement-breakpoint
CREATE INDEX `organizationRole_role_idx` ON `organization_role` (`role`);--> statement-breakpoint
CREATE TABLE `two_factor` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `ai` (
	`aiId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`apiUrl` text NOT NULL,
	`apiKey` text NOT NULL,
	`model` text NOT NULL,
	`isEnabled` integer DEFAULT true NOT NULL,
	`organizationId` text NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `application` (
	`applicationId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`appName` text NOT NULL,
	`description` text,
	`env` text,
	`previewEnv` text,
	`watchPaths` text,
	`previewBuildArgs` text,
	`previewBuildSecrets` text,
	`previewLabels` text,
	`previewWildcard` text,
	`previewPort` integer DEFAULT 3000,
	`previewHttps` integer DEFAULT false NOT NULL,
	`previewPath` text DEFAULT '/',
	`certificateType` text DEFAULT 'none' NOT NULL,
	`previewCustomCertResolver` text,
	`previewLimit` integer DEFAULT 3,
	`isPreviewDeploymentsActive` integer DEFAULT false,
	`previewRequireCollaboratorPermissions` integer DEFAULT true,
	`rollbackActive` integer DEFAULT false,
	`buildArgs` text,
	`buildSecrets` text,
	`memoryReservation` text,
	`memoryLimit` text,
	`cpuReservation` text,
	`cpuLimit` text,
	`title` text,
	`enabled` integer,
	`subtitle` text,
	`command` text,
	`args` text,
	`icon` text,
	`refreshToken` text,
	`sourceType` text DEFAULT 'github' NOT NULL,
	`cleanCache` integer DEFAULT false,
	`repository` text,
	`owner` text,
	`branch` text,
	`buildPath` text DEFAULT '/',
	`triggerType` text DEFAULT 'push',
	`autoDeploy` integer,
	`gitlabProjectId` integer,
	`gitlabRepository` text,
	`gitlabOwner` text,
	`gitlabBranch` text,
	`gitlabBuildPath` text DEFAULT '/',
	`gitlabPathNamespace` text,
	`giteaRepository` text,
	`giteaOwner` text,
	`giteaBranch` text,
	`giteaBuildPath` text DEFAULT '/',
	`bitbucketRepository` text,
	`bitbucketRepositorySlug` text,
	`bitbucketOwner` text,
	`bitbucketBranch` text,
	`bitbucketBuildPath` text DEFAULT '/',
	`username` text,
	`password` text,
	`dockerImage` text,
	`registryUrl` text,
	`customGitUrl` text,
	`customGitBranch` text,
	`customGitBuildPath` text,
	`customGitSSHKeyId` text,
	`enableSubmodules` integer DEFAULT false NOT NULL,
	`dockerfile` text DEFAULT 'Dockerfile',
	`dockerContextPath` text,
	`dockerBuildStage` text,
	`dropBuildPath` text,
	`healthCheckSwarm` text,
	`restartPolicySwarm` text,
	`placementSwarm` text,
	`updateConfigSwarm` text,
	`rollbackConfigSwarm` text,
	`modeSwarm` text,
	`labelsSwarm` text,
	`networkSwarm` text,
	`stopGracePeriodSwarm` blob,
	`endpointSpecSwarm` text,
	`ulimitsSwarm` text,
	`replicas` integer DEFAULT 1 NOT NULL,
	`applicationStatus` text DEFAULT 'idle' NOT NULL,
	`buildType` text DEFAULT 'nixpacks' NOT NULL,
	`deployTarget` text DEFAULT 'local' NOT NULL,
	`k8sClusterId` text,
	`k8sNamespace` text,
	`railpackVersion` text DEFAULT '0.15.4',
	`herokuVersion` text DEFAULT '24',
	`publishDirectory` text,
	`isStaticSpa` integer,
	`createEnvFile` integer DEFAULT true NOT NULL,
	`createdAt` text NOT NULL,
	`registryId` text,
	`rollbackRegistryId` text,
	`environmentId` text NOT NULL,
	`githubId` text,
	`gitlabId` text,
	`giteaId` text,
	`bitbucketId` text,
	`serverId` text,
	`buildServerId` text,
	`buildRegistryId` text,
	FOREIGN KEY (`customGitSSHKeyId`) REFERENCES `ssh-key`(`sshKeyId`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`registryId`) REFERENCES `registry`(`registryId`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`rollbackRegistryId`) REFERENCES `registry`(`registryId`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`environmentId`) REFERENCES `environment`(`environmentId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`githubId`) REFERENCES `github`(`githubId`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`gitlabId`) REFERENCES `gitlab`(`gitlabId`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`giteaId`) REFERENCES `gitea`(`giteaId`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bitbucketId`) REFERENCES `bitbucket`(`bitbucketId`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`serverId`) REFERENCES `server`(`serverId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`buildServerId`) REFERENCES `server`(`serverId`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`buildRegistryId`) REFERENCES `registry`(`registryId`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_appName_unique` ON `application` (`appName`);--> statement-breakpoint
CREATE TABLE `arcd_runner` (
	`runnerId` text PRIMARY KEY NOT NULL,
	`poolLabel` text NOT NULL,
	`secret` text NOT NULL,
	`lastSeen` text,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`user_id` text,
	`user_email` text NOT NULL,
	`user_role` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`resource_name` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `auditLog_organizationId_idx` ON `audit_log` (`organization_id`);--> statement-breakpoint
CREATE INDEX `auditLog_userId_idx` ON `audit_log` (`user_id`);--> statement-breakpoint
CREATE INDEX `auditLog_createdAt_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `backup` (
	`backupId` text PRIMARY KEY NOT NULL,
	`appName` text NOT NULL,
	`schedule` text NOT NULL,
	`enabled` integer,
	`database` text NOT NULL,
	`prefix` text NOT NULL,
	`serviceName` text,
	`destinationId` text NOT NULL,
	`keepLatestCount` integer,
	`backupType` text DEFAULT 'database' NOT NULL,
	`databaseType` text NOT NULL,
	`composeId` text,
	`postgresId` text,
	`mariadbId` text,
	`mysqlId` text,
	`mongoId` text,
	`libsqlId` text,
	`userId` text,
	`metadata` text,
	FOREIGN KEY (`destinationId`) REFERENCES `destination`(`destinationId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`composeId`) REFERENCES `compose`(`composeId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`postgresId`) REFERENCES `postgres`(`postgresId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mariadbId`) REFERENCES `mariadb`(`mariadbId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mysqlId`) REFERENCES `mysql`(`mysqlId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mongoId`) REFERENCES `mongo`(`mongoId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`libsqlId`) REFERENCES `libsql`(`libsqlId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backup_appName_unique` ON `backup` (`appName`);--> statement-breakpoint
CREATE TABLE `billing_record` (
	`billingId` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`doksClusterId` text,
	`monthlyTotal` real DEFAULT 0 NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`markup` real DEFAULT 0 NOT NULL,
	`markupPercent` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`calculatedAt` text NOT NULL,
	`items` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`doksClusterId`) REFERENCES `doks_cluster`(`doksClusterId`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `bitbucket` (
	`bitbucketId` text PRIMARY KEY NOT NULL,
	`bitbucketUsername` text,
	`bitbucketEmail` text,
	`appPassword` text,
	`apiToken` text,
	`bitbucketWorkspaceName` text,
	`gitProviderId` text NOT NULL,
	FOREIGN KEY (`gitProviderId`) REFERENCES `git_provider`(`gitProviderId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `build_job` (
	`buildJobId` text PRIMARY KEY NOT NULL,
	`repo` text NOT NULL,
	`sha` text NOT NULL,
	`ref` text NOT NULL,
	`branch` text NOT NULL,
	`target` text NOT NULL,
	`runnerPool` text NOT NULL,
	`image` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`dispatchId` text,
	`logs` text DEFAULT '' NOT NULL,
	`error` text,
	`rolloutStatus` text DEFAULT 'skipped' NOT NULL,
	`rolloutTarget` text,
	`attempt` integer DEFAULT 0 NOT NULL,
	`createdAt` text NOT NULL,
	`startedAt` text,
	`finishedAt` text,
	`organizationId` text NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `certificate` (
	`certificateId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`certificateData` text NOT NULL,
	`privateKey` text NOT NULL,
	`certificatePath` text NOT NULL,
	`autoRenew` integer,
	`organizationId` text NOT NULL,
	`serverId` text,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`serverId`) REFERENCES `server`(`serverId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `certificate_certificatePath_unique` ON `certificate` (`certificatePath`);--> statement-breakpoint
CREATE TABLE `cloud_provider` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider_type` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`credentials` text NOT NULL,
	`default_region` text DEFAULT 'nyc1' NOT NULL,
	`default_size` text DEFAULT 's-2vcpu-4gb' NOT NULL,
	`default_image` text DEFAULT 'ubuntu-22-04-x64' NOT NULL,
	`vpc_config` text,
	`ssh_key_ids` text DEFAULT '[]',
	`firewall_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_validated` integer,
	`validation_error` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cloud_provider_org` ON `cloud_provider` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_cloud_provider_type` ON `cloud_provider` (`provider_type`);--> statement-breakpoint
CREATE INDEX `idx_cloud_provider_slug` ON `cloud_provider` (`organization_id`,`slug`);--> statement-breakpoint
CREATE TABLE `provisioned_instance` (
	`instance_id` text PRIMARY KEY NOT NULL,
	`cloud_provider_id` text NOT NULL,
	`pool_id` text,
	`compute_node_id` text,
	`external_id` text,
	`external_name` text NOT NULL,
	`region` text NOT NULL,
	`size` text NOT NULL,
	`image` text NOT NULL,
	`vpc_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`public_ip` text,
	`private_ip` text,
	`public_ipv6` text,
	`registration_token` text,
	`registration_expiry` integer,
	`swarm_join_token` text,
	`cpu_cores` integer NOT NULL,
	`memory_mb` integer NOT NULL,
	`storage_gb` integer NOT NULL,
	`gpu_count` integer DEFAULT 0,
	`hourly_price` text,
	`monthly_price` text,
	`tags` text DEFAULT '[]',
	`last_error` text,
	`error_count` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`provisioned_at` integer,
	`registered_at` integer,
	`terminated_at` integer,
	FOREIGN KEY (`cloud_provider_id`) REFERENCES `cloud_provider`(`provider_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pool_id`) REFERENCES `compute_pool`(`pool_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`compute_node_id`) REFERENCES `compute_node`(`node_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_provisioned_instance_provider` ON `provisioned_instance` (`cloud_provider_id`);--> statement-breakpoint
CREATE INDEX `idx_provisioned_instance_pool` ON `provisioned_instance` (`pool_id`);--> statement-breakpoint
CREATE INDEX `idx_provisioned_instance_node` ON `provisioned_instance` (`compute_node_id`);--> statement-breakpoint
CREATE INDEX `idx_provisioned_instance_status` ON `provisioned_instance` (`status`);--> statement-breakpoint
CREATE INDEX `idx_provisioned_instance_external` ON `provisioned_instance` (`external_id`);--> statement-breakpoint
CREATE TABLE `scaling_job` (
	`job_id` text PRIMARY KEY NOT NULL,
	`pool_id` text NOT NULL,
	`cloud_provider_id` text NOT NULL,
	`job_type` text NOT NULL,
	`config` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`created_node_ids` text DEFAULT '[]',
	`removed_node_ids` text DEFAULT '[]',
	`error` text,
	`error_details` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`pool_id`) REFERENCES `compute_pool`(`pool_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cloud_provider_id`) REFERENCES `cloud_provider`(`provider_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_scaling_job_pool` ON `scaling_job` (`pool_id`);--> statement-breakpoint
CREATE INDEX `idx_scaling_job_status` ON `scaling_job` (`status`);--> statement-breakpoint
CREATE TABLE `compose` (
	`composeId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`appName` text NOT NULL,
	`description` text,
	`env` text,
	`composeFile` text DEFAULT '' NOT NULL,
	`refreshToken` text,
	`sourceType` text DEFAULT 'github' NOT NULL,
	`composeType` text DEFAULT 'docker-compose' NOT NULL,
	`repository` text,
	`owner` text,
	`branch` text,
	`autoDeploy` integer,
	`gitlabProjectId` integer,
	`gitlabRepository` text,
	`gitlabOwner` text,
	`gitlabBranch` text,
	`gitlabPathNamespace` text,
	`bitbucketRepository` text,
	`bitbucketRepositorySlug` text,
	`bitbucketOwner` text,
	`bitbucketBranch` text,
	`giteaRepository` text,
	`giteaOwner` text,
	`giteaBranch` text,
	`customGitUrl` text,
	`customGitBranch` text,
	`customGitSSHKeyId` text,
	`command` text DEFAULT '' NOT NULL,
	`enableSubmodules` integer DEFAULT false NOT NULL,
	`composePath` text DEFAULT './docker-compose.yml' NOT NULL,
	`suffix` text DEFAULT '' NOT NULL,
	`randomize` integer DEFAULT false NOT NULL,
	`isolatedDeployment` integer DEFAULT false NOT NULL,
	`isolatedDeploymentsVolume` integer DEFAULT false NOT NULL,
	`triggerType` text DEFAULT 'push',
	`composeStatus` text DEFAULT 'idle' NOT NULL,
	`environmentId` text NOT NULL,
	`createdAt` text NOT NULL,
	`watchPaths` text,
	`githubId` text,
	`gitlabId` text,
	`bitbucketId` text,
	`giteaId` text,
	`serverId` text,
	FOREIGN KEY (`customGitSSHKeyId`) REFERENCES `ssh-key`(`sshKeyId`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`environmentId`) REFERENCES `environment`(`environmentId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`githubId`) REFERENCES `github`(`githubId`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`gitlabId`) REFERENCES `gitlab`(`gitlabId`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bitbucketId`) REFERENCES `bitbucket`(`bitbucketId`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`giteaId`) REFERENCES `gitea`(`giteaId`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`serverId`) REFERENCES `server`(`serverId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `compute_lease` (
	`lease_id` text PRIMARY KEY NOT NULL,
	`offer_id` text NOT NULL,
	`pool_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`node_id` text,
	`name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`network_tx_hash` text,
	`network_lease_id` text,
	`allocated_resources` text NOT NULL,
	`pricing_snapshot` text NOT NULL,
	`requested_at` integer NOT NULL,
	`provisioned_at` integer,
	`started_at` integer,
	`terminated_at` integer,
	`expires_at` integer,
	`requested_duration_minutes` integer,
	`actual_duration_seconds` integer DEFAULT 0,
	`billed_amount` text DEFAULT '0',
	`last_billed_at` integer,
	`wallet_id` text,
	`access_credentials` text,
	`connection_info` text,
	`usage_metrics` text DEFAULT '{}',
	`termination_reason` text,
	`terminated_by` text,
	`metadata` text,
	`labels` text DEFAULT '{}',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`offer_id`) REFERENCES `compute_offer`(`offer_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`pool_id`) REFERENCES `compute_pool`(`pool_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `compute_node`(`node_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`wallet_id`) REFERENCES `organization_wallet`(`wallet_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_compute_lease_offer` ON `compute_lease` (`offer_id`);--> statement-breakpoint
CREATE INDEX `idx_compute_lease_pool` ON `compute_lease` (`pool_id`);--> statement-breakpoint
CREATE INDEX `idx_compute_lease_org` ON `compute_lease` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_compute_lease_user` ON `compute_lease` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_compute_lease_node` ON `compute_lease` (`node_id`);--> statement-breakpoint
CREATE INDEX `idx_compute_lease_status` ON `compute_lease` (`status`);--> statement-breakpoint
CREATE INDEX `idx_compute_lease_wallet` ON `compute_lease` (`wallet_id`);--> statement-breakpoint
CREATE INDEX `idx_compute_lease_expires` ON `compute_lease` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_compute_lease_network` ON `compute_lease` (`network_lease_id`);--> statement-breakpoint
CREATE TABLE `compute_offer` (
	`offer_id` text PRIMARY KEY NOT NULL,
	`pool_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`resource_spec` text NOT NULL,
	`pricing_model` text DEFAULT 'per_hour' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`base_price` text NOT NULL,
	`price_per_cpu_hour` text,
	`price_per_gb_memory_hour` text,
	`price_per_gb_storage_hour` text,
	`price_per_gpu_hour` text,
	`price_per_gb_egress` text,
	`billing_cycle` text DEFAULT 'hourly' NOT NULL,
	`minimum_billing_minutes` integer DEFAULT 60,
	`spot_discount` text,
	`reserved_discount` text,
	`annual_discount` text,
	`total_capacity` integer DEFAULT 1 NOT NULL,
	`used_capacity` integer DEFAULT 0 NOT NULL,
	`available_capacity` integer DEFAULT 1 NOT NULL,
	`min_lease_duration_minutes` integer DEFAULT 60,
	`max_lease_duration_days` integer DEFAULT 365,
	`max_concurrent_leases_per_org` integer DEFAULT 10,
	`valid_from` integer,
	`valid_until` integer,
	`sla` text DEFAULT '{}',
	`features` text DEFAULT '[]',
	`restrictions` text DEFAULT '{}',
	`metadata` text,
	`tags` text DEFAULT '[]',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`pool_id`) REFERENCES `compute_pool`(`pool_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_compute_offer_pool` ON `compute_offer` (`pool_id`);--> statement-breakpoint
CREATE INDEX `idx_compute_offer_status` ON `compute_offer` (`status`);--> statement-breakpoint
CREATE INDEX `idx_compute_offer_pricing` ON `compute_offer` (`pricing_model`);--> statement-breakpoint
CREATE INDEX `idx_compute_offer_slug` ON `compute_offer` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_compute_offer_price` ON `compute_offer` (`base_price`);--> statement-breakpoint
CREATE INDEX `idx_compute_offer_capacity` ON `compute_offer` (`available_capacity`);--> statement-breakpoint
CREATE TABLE `compute_usage` (
	`usage_id` text PRIMARY KEY NOT NULL,
	`lease_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`offer_id` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`duration_seconds` integer NOT NULL,
	`cpu_seconds` text DEFAULT '0' NOT NULL,
	`memory_gb_seconds` text DEFAULT '0' NOT NULL,
	`storage_gb_seconds` text DEFAULT '0' NOT NULL,
	`gpu_seconds` text DEFAULT '0' NOT NULL,
	`egress_gb` text DEFAULT '0' NOT NULL,
	`cpu_cost` text DEFAULT '0' NOT NULL,
	`memory_cost` text DEFAULT '0' NOT NULL,
	`storage_cost` text DEFAULT '0' NOT NULL,
	`gpu_cost` text DEFAULT '0' NOT NULL,
	`egress_cost` text DEFAULT '0' NOT NULL,
	`base_cost` text DEFAULT '0' NOT NULL,
	`total_cost` text DEFAULT '0' NOT NULL,
	`charged` integer DEFAULT false NOT NULL,
	`charged_at` integer,
	`transaction_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`lease_id`) REFERENCES `compute_lease`(`lease_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`offer_id`) REFERENCES `compute_offer`(`offer_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `wallet_transactions`(`transaction_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_compute_usage_lease` ON `compute_usage` (`lease_id`);--> statement-breakpoint
CREATE INDEX `idx_compute_usage_org` ON `compute_usage` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_compute_usage_period` ON `compute_usage` (`period_start`,`period_end`);--> statement-breakpoint
CREATE INDEX `idx_compute_usage_uncharged` ON `compute_usage` (`charged`);--> statement-breakpoint
CREATE TABLE `compute_node` (
	`node_id` text PRIMARY KEY NOT NULL,
	`pool_id` text NOT NULL,
	`name` text NOT NULL,
	`hostname` text,
	`network_address` text,
	`peer_id` text,
	`ip_address` text,
	`port` integer DEFAULT 4500,
	`node_type` text DEFAULT 'worker' NOT NULL,
	`status` text DEFAULT 'offline' NOT NULL,
	`region` text NOT NULL,
	`datacenter` text,
	`availability_zone` text,
	`cpu_cores` integer NOT NULL,
	`cpu_model` text,
	`cpu_architecture` text DEFAULT 'x86_64',
	`cpu_frequency_mhz` integer,
	`memory_mb` integer NOT NULL,
	`memory_type` text,
	`storage_gb` integer NOT NULL,
	`storage_type` text,
	`storage_iops` integer,
	`gpu_count` integer DEFAULT 0,
	`gpu_vendor` text,
	`gpu_model` text,
	`gpu_memory_mb` integer,
	`gpu_compute_capability` text,
	`network_bandwidth_mbps` integer DEFAULT 1000,
	`cpu_utilization_percent` text DEFAULT '0',
	`memory_utilization_percent` text DEFAULT '0',
	`storage_utilization_percent` text DEFAULT '0',
	`gpu_utilization_percent` text DEFAULT '0',
	`uptime_seconds` integer DEFAULT 0,
	`last_heartbeat` integer,
	`health_score` text DEFAULT '100',
	`os_version` text,
	`runtime_version` text,
	`agent_version` text,
	`labels` text DEFAULT '{}',
	`taints` text DEFAULT '[]',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`registered_at` integer,
	FOREIGN KEY (`pool_id`) REFERENCES `compute_pool`(`pool_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_compute_node_pool` ON `compute_node` (`pool_id`);--> statement-breakpoint
CREATE INDEX `idx_compute_node_status` ON `compute_node` (`status`);--> statement-breakpoint
CREATE INDEX `idx_compute_node_type` ON `compute_node` (`node_type`);--> statement-breakpoint
CREATE INDEX `idx_compute_node_region` ON `compute_node` (`region`);--> statement-breakpoint
CREATE INDEX `idx_compute_node_network` ON `compute_node` (`network_address`);--> statement-breakpoint
CREATE INDEX `idx_compute_node_heartbeat` ON `compute_node` (`last_heartbeat`);--> statement-breakpoint
CREATE TABLE `compute_pool` (
	`pool_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`network_address` text,
	`peer_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`regions` text DEFAULT '[]' NOT NULL,
	`primary_region` text,
	`total_cpu_cores` integer DEFAULT 0 NOT NULL,
	`total_memory_mb` integer DEFAULT 0 NOT NULL,
	`total_storage_gb` integer DEFAULT 0 NOT NULL,
	`total_gpu_count` integer DEFAULT 0 NOT NULL,
	`available_cpu_cores` integer DEFAULT 0 NOT NULL,
	`available_memory_mb` integer DEFAULT 0 NOT NULL,
	`available_storage_gb` integer DEFAULT 0 NOT NULL,
	`available_gpu_count` integer DEFAULT 0 NOT NULL,
	`total_nodes` integer DEFAULT 0 NOT NULL,
	`active_nodes` integer DEFAULT 0 NOT NULL,
	`config` text DEFAULT '{}',
	`certifications` text DEFAULT '[]',
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_health_check` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_compute_pool_org` ON `compute_pool` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_compute_pool_status` ON `compute_pool` (`status`);--> statement-breakpoint
CREATE INDEX `idx_compute_pool_region` ON `compute_pool` (`primary_region`);--> statement-breakpoint
CREATE INDEX `idx_compute_pool_slug` ON `compute_pool` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_compute_pool_network` ON `compute_pool` (`network_address`);--> statement-breakpoint
CREATE TABLE `deploy_provider` (
	`deployProviderId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`providerType` text NOT NULL,
	`apiToken` text,
	`accountId` text,
	`credentialsJson` text,
	`isDefault` integer DEFAULT false NOT NULL,
	`organizationId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `deployment` (
	`deploymentId` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'running',
	`logPath` text NOT NULL,
	`pid` text,
	`applicationId` text,
	`composeId` text,
	`serverId` text,
	`isPreviewDeployment` integer DEFAULT false,
	`previewDeploymentId` text,
	`createdAt` text NOT NULL,
	`startedAt` text,
	`finishedAt` text,
	`errorMessage` text,
	`scheduleId` text,
	`backupId` text,
	`rollbackId` text,
	`volumeBackupId` text,
	`buildServerId` text,
	FOREIGN KEY (`applicationId`) REFERENCES `application`(`applicationId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`composeId`) REFERENCES `compose`(`composeId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`serverId`) REFERENCES `server`(`serverId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`previewDeploymentId`) REFERENCES `preview_deployments`(`previewDeploymentId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scheduleId`) REFERENCES `schedule`(`scheduleId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`backupId`) REFERENCES `backup`(`backupId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rollbackId`) REFERENCES `rollback`(`rollbackId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`volumeBackupId`) REFERENCES `volume_backup`(`volumeBackupId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`buildServerId`) REFERENCES `server`(`serverId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `destination` (
	`destinationId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`provider` text,
	`accessKey` text NOT NULL,
	`secretAccessKey` text NOT NULL,
	`bucket` text NOT NULL,
	`region` text NOT NULL,
	`endpoint` text NOT NULL,
	`additionalFlags` text,
	`organizationId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `doks_cluster` (
	`doksClusterId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`doClusterId` text,
	`region` text DEFAULT 'sfo3' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`endpoint` text,
	`k8sVersion` text DEFAULT '1.34.1-do.3',
	`ha` integer DEFAULT false NOT NULL,
	`autoUpgrade` integer DEFAULT true NOT NULL,
	`surgeUpgrade` integer DEFAULT true NOT NULL,
	`organizationId` text NOT NULL,
	`createdAt` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`maintenancePolicy` text DEFAULT '{"startTime":"04:00","day":"sunday"}',
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `doks_node_pool` (
	`poolId` text PRIMARY KEY NOT NULL,
	`doPoolId` text,
	`name` text NOT NULL,
	`size` text DEFAULT 's-2vcpu-4gb' NOT NULL,
	`count` integer DEFAULT 2 NOT NULL,
	`minNodes` integer DEFAULT 1 NOT NULL,
	`maxNodes` integer DEFAULT 6 NOT NULL,
	`autoScale` integer DEFAULT true NOT NULL,
	`doksClusterId` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`doksClusterId`) REFERENCES `doks_cluster`(`doksClusterId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `domain` (
	`domainId` text PRIMARY KEY NOT NULL,
	`host` text NOT NULL,
	`https` integer DEFAULT false NOT NULL,
	`port` integer DEFAULT 3000,
	`customEntrypoint` text,
	`path` text DEFAULT '/',
	`serviceName` text,
	`domainType` text DEFAULT 'application',
	`uniqueConfigKey` integer NOT NULL,
	`createdAt` text NOT NULL,
	`composeId` text,
	`customCertResolver` text,
	`applicationId` text,
	`previewDeploymentId` text,
	`certificateType` text DEFAULT 'none' NOT NULL,
	`internalPath` text DEFAULT '/',
	`stripPath` integer DEFAULT false NOT NULL,
	`middlewares` text DEFAULT '[]',
	FOREIGN KEY (`composeId`) REFERENCES `compose`(`composeId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`applicationId`) REFERENCES `application`(`applicationId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`previewDeploymentId`) REFERENCES `preview_deployments`(`previewDeploymentId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `environment` (
	`environmentId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`createdAt` text NOT NULL,
	`env` text DEFAULT '' NOT NULL,
	`projectId` text NOT NULL,
	`isDefault` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `project`(`projectId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rate_limit_rule` (
	`rateLimitRuleId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scope` text DEFAULT 'global' NOT NULL,
	`scopeId` text,
	`requestsPerMinute` integer DEFAULT 60 NOT NULL,
	`burstSize` integer DEFAULT 10 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `routing_rule` (
	`routingRuleId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`pathPrefix` text,
	`backend` text NOT NULL,
	`middlewares` text DEFAULT '[]' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `git_provider` (
	`gitProviderId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`providerType` text DEFAULT 'github' NOT NULL,
	`createdAt` text NOT NULL,
	`organizationId` text NOT NULL,
	`userId` text NOT NULL,
	`sharedWithOrganization` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `gitea` (
	`giteaId` text PRIMARY KEY NOT NULL,
	`giteaUrl` text DEFAULT 'https://gitea.com' NOT NULL,
	`giteaInternalUrl` text,
	`redirect_uri` text,
	`client_id` text,
	`client_secret` text,
	`gitProviderId` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`expires_at` integer,
	`scopes` text DEFAULT 'repo,repo:status,read:user,read:org',
	`last_authenticated_at` integer,
	FOREIGN KEY (`gitProviderId`) REFERENCES `git_provider`(`gitProviderId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `github` (
	`githubId` text PRIMARY KEY NOT NULL,
	`githubAppName` text,
	`githubAppId` integer,
	`githubClientId` text,
	`githubClientSecret` text,
	`githubInstallationId` text,
	`githubPrivateKey` text,
	`githubWebhookSecret` text,
	`gitProviderId` text NOT NULL,
	FOREIGN KEY (`gitProviderId`) REFERENCES `git_provider`(`gitProviderId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `gitlab` (
	`gitlabId` text PRIMARY KEY NOT NULL,
	`gitlabUrl` text DEFAULT 'https://gitlab.com' NOT NULL,
	`gitlabInternalUrl` text,
	`application_id` text,
	`redirect_uri` text,
	`secret` text,
	`access_token` text,
	`refresh_token` text,
	`group_name` text,
	`expires_at` integer,
	`gitProviderId` text NOT NULL,
	FOREIGN KEY (`gitProviderId`) REFERENCES `git_provider`(`gitProviderId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `libsql` (
	`libsqlId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`appName` text NOT NULL,
	`description` text,
	`databaseUser` text NOT NULL,
	`databasePassword` text NOT NULL,
	`sqldNode` text DEFAULT 'primary' NOT NULL,
	`sqldPrimaryUrl` text,
	`enableNamespaces` integer DEFAULT false NOT NULL,
	`dockerImage` text NOT NULL,
	`command` text,
	`env` text,
	`memoryReservation` text,
	`memoryLimit` text,
	`cpuReservation` text,
	`cpuLimit` text,
	`externalPort` integer,
	`externalGRPCPort` integer,
	`externalAdminPort` integer,
	`applicationStatus` text DEFAULT 'idle' NOT NULL,
	`healthCheckSwarm` text,
	`restartPolicySwarm` text,
	`placementSwarm` text,
	`updateConfigSwarm` text,
	`rollbackConfigSwarm` text,
	`modeSwarm` text,
	`labelsSwarm` text,
	`networkSwarm` text,
	`stopGracePeriodSwarm` blob,
	`endpointSpecSwarm` text,
	`replicas` integer DEFAULT 1 NOT NULL,
	`createdAt` text NOT NULL,
	`environmentId` text NOT NULL,
	`serverId` text,
	FOREIGN KEY (`environmentId`) REFERENCES `environment`(`environmentId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`serverId`) REFERENCES `server`(`serverId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `libsql_appName_unique` ON `libsql` (`appName`);--> statement-breakpoint
CREATE TABLE `mariadb` (
	`mariadbId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`appName` text NOT NULL,
	`description` text,
	`databaseName` text NOT NULL,
	`databaseUser` text NOT NULL,
	`databasePassword` text NOT NULL,
	`rootPassword` text NOT NULL,
	`dockerImage` text NOT NULL,
	`command` text,
	`args` text,
	`env` text,
	`memoryReservation` text,
	`memoryLimit` text,
	`cpuReservation` text,
	`cpuLimit` text,
	`externalPort` integer,
	`applicationStatus` text DEFAULT 'idle' NOT NULL,
	`healthCheckSwarm` text,
	`restartPolicySwarm` text,
	`placementSwarm` text,
	`updateConfigSwarm` text,
	`rollbackConfigSwarm` text,
	`modeSwarm` text,
	`labelsSwarm` text,
	`networkSwarm` text,
	`stopGracePeriodSwarm` blob,
	`endpointSpecSwarm` text,
	`ulimitsSwarm` text,
	`replicas` integer DEFAULT 1 NOT NULL,
	`createdAt` text NOT NULL,
	`environmentId` text NOT NULL,
	`serverId` text,
	FOREIGN KEY (`environmentId`) REFERENCES `environment`(`environmentId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`serverId`) REFERENCES `server`(`serverId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mariadb_appName_unique` ON `mariadb` (`appName`);--> statement-breakpoint
CREATE TABLE `mongo` (
	`mongoId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`appName` text NOT NULL,
	`description` text,
	`databaseUser` text NOT NULL,
	`databasePassword` text NOT NULL,
	`dockerImage` text NOT NULL,
	`command` text,
	`args` text,
	`env` text,
	`memoryReservation` text,
	`memoryLimit` text,
	`cpuReservation` text,
	`cpuLimit` text,
	`externalPort` integer,
	`applicationStatus` text DEFAULT 'idle' NOT NULL,
	`healthCheckSwarm` text,
	`restartPolicySwarm` text,
	`placementSwarm` text,
	`updateConfigSwarm` text,
	`rollbackConfigSwarm` text,
	`modeSwarm` text,
	`labelsSwarm` text,
	`networkSwarm` text,
	`stopGracePeriodSwarm` blob,
	`endpointSpecSwarm` text,
	`ulimitsSwarm` text,
	`replicas` integer DEFAULT 1 NOT NULL,
	`createdAt` text NOT NULL,
	`environmentId` text NOT NULL,
	`serverId` text,
	`replicaSets` integer DEFAULT false,
	FOREIGN KEY (`environmentId`) REFERENCES `environment`(`environmentId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`serverId`) REFERENCES `server`(`serverId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mongo_appName_unique` ON `mongo` (`appName`);--> statement-breakpoint
CREATE TABLE `mount` (
	`mountId` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`hostPath` text,
	`volumeName` text,
	`filePath` text,
	`content` text,
	`serviceType` text DEFAULT 'application' NOT NULL,
	`mountPath` text NOT NULL,
	`applicationId` text,
	`postgresId` text,
	`mariadbId` text,
	`mongoId` text,
	`mysqlId` text,
	`redisId` text,
	`composeId` text,
	`libsqlId` text,
	FOREIGN KEY (`applicationId`) REFERENCES `application`(`applicationId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`postgresId`) REFERENCES `postgres`(`postgresId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mariadbId`) REFERENCES `mariadb`(`mariadbId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mongoId`) REFERENCES `mongo`(`mongoId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mysqlId`) REFERENCES `mysql`(`mysqlId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`redisId`) REFERENCES `redis`(`redisId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`composeId`) REFERENCES `compose`(`composeId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`libsqlId`) REFERENCES `libsql`(`libsqlId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `mysql` (
	`mysqlId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`appName` text NOT NULL,
	`description` text,
	`databaseName` text NOT NULL,
	`databaseUser` text NOT NULL,
	`databasePassword` text NOT NULL,
	`rootPassword` text NOT NULL,
	`dockerImage` text NOT NULL,
	`command` text,
	`args` text,
	`env` text,
	`memoryReservation` text,
	`memoryLimit` text,
	`cpuReservation` text,
	`cpuLimit` text,
	`externalPort` integer,
	`applicationStatus` text DEFAULT 'idle' NOT NULL,
	`healthCheckSwarm` text,
	`restartPolicySwarm` text,
	`placementSwarm` text,
	`updateConfigSwarm` text,
	`rollbackConfigSwarm` text,
	`modeSwarm` text,
	`labelsSwarm` text,
	`networkSwarm` text,
	`stopGracePeriodSwarm` blob,
	`endpointSpecSwarm` text,
	`ulimitsSwarm` text,
	`replicas` integer DEFAULT 1 NOT NULL,
	`createdAt` text NOT NULL,
	`environmentId` text NOT NULL,
	`serverId` text,
	FOREIGN KEY (`environmentId`) REFERENCES `environment`(`environmentId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`serverId`) REFERENCES `server`(`serverId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mysql_appName_unique` ON `mysql` (`appName`);--> statement-breakpoint
CREATE TABLE `custom` (
	`customId` text PRIMARY KEY NOT NULL,
	`endpoint` text NOT NULL,
	`headers` text
);
--> statement-breakpoint
CREATE TABLE `discord` (
	`discordId` text PRIMARY KEY NOT NULL,
	`webhookUrl` text NOT NULL,
	`decoration` integer
);
--> statement-breakpoint
CREATE TABLE `email` (
	`emailId` text PRIMARY KEY NOT NULL,
	`smtpServer` text NOT NULL,
	`smtpPort` integer NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`fromAddress` text NOT NULL,
	`toAddress` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gotify` (
	`gotifyId` text PRIMARY KEY NOT NULL,
	`serverUrl` text NOT NULL,
	`appToken` text NOT NULL,
	`priority` integer DEFAULT 5 NOT NULL,
	`decoration` integer
);
--> statement-breakpoint
CREATE TABLE `lark` (
	`larkId` text PRIMARY KEY NOT NULL,
	`webhookUrl` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mattermost` (
	`mattermostId` text PRIMARY KEY NOT NULL,
	`webhookUrl` text NOT NULL,
	`channel` text,
	`username` text
);
--> statement-breakpoint
CREATE TABLE `notification` (
	`notificationId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`appDeploy` integer DEFAULT false NOT NULL,
	`appBuildError` integer DEFAULT false NOT NULL,
	`databaseBackup` integer DEFAULT false NOT NULL,
	`volumeBackup` integer DEFAULT false NOT NULL,
	`hanzoRestart` integer DEFAULT false NOT NULL,
	`dockerCleanup` integer DEFAULT false NOT NULL,
	`serverThreshold` integer DEFAULT false NOT NULL,
	`notificationType` text NOT NULL,
	`createdAt` text NOT NULL,
	`slackId` text,
	`telegramId` text,
	`discordId` text,
	`emailId` text,
	`resendId` text,
	`gotifyId` text,
	`ntfyId` text,
	`mattermostId` text,
	`customId` text,
	`larkId` text,
	`pushoverId` text,
	`teamsId` text,
	`organizationId` text NOT NULL,
	FOREIGN KEY (`slackId`) REFERENCES `slack`(`slackId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`telegramId`) REFERENCES `telegram`(`telegramId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`discordId`) REFERENCES `discord`(`discordId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`emailId`) REFERENCES `email`(`emailId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resendId`) REFERENCES `resend`(`resendId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`gotifyId`) REFERENCES `gotify`(`gotifyId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ntfyId`) REFERENCES `ntfy`(`ntfyId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mattermostId`) REFERENCES `mattermost`(`mattermostId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customId`) REFERENCES `custom`(`customId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`larkId`) REFERENCES `lark`(`larkId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pushoverId`) REFERENCES `pushover`(`pushoverId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`teamsId`) REFERENCES `teams`(`teamsId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ntfy` (
	`ntfyId` text PRIMARY KEY NOT NULL,
	`serverUrl` text NOT NULL,
	`topic` text NOT NULL,
	`accessToken` text,
	`priority` integer DEFAULT 3 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pushover` (
	`pushoverId` text PRIMARY KEY NOT NULL,
	`userKey` text NOT NULL,
	`apiToken` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`retry` integer,
	`expire` integer
);
--> statement-breakpoint
CREATE TABLE `resend` (
	`resendId` text PRIMARY KEY NOT NULL,
	`apiKey` text NOT NULL,
	`fromAddress` text NOT NULL,
	`toAddress` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slack` (
	`slackId` text PRIMARY KEY NOT NULL,
	`webhookUrl` text NOT NULL,
	`channel` text
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`teamsId` text PRIMARY KEY NOT NULL,
	`webhookUrl` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `telegram` (
	`telegramId` text PRIMARY KEY NOT NULL,
	`botToken` text NOT NULL,
	`chatId` text NOT NULL,
	`messageThreadId` text
);
--> statement-breakpoint
CREATE TABLE `patch` (
	`patchId` text PRIMARY KEY NOT NULL,
	`type` text DEFAULT 'update' NOT NULL,
	`filePath` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`content` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text,
	`applicationId` text,
	`composeId` text,
	FOREIGN KEY (`applicationId`) REFERENCES `application`(`applicationId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`composeId`) REFERENCES `compose`(`composeId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patch_filepath_application_unique` ON `patch` (`filePath`,`applicationId`);--> statement-breakpoint
CREATE UNIQUE INDEX `patch_filepath_compose_unique` ON `patch` (`filePath`,`composeId`);--> statement-breakpoint
CREATE TABLE `port` (
	`portId` text PRIMARY KEY NOT NULL,
	`publishedPort` integer NOT NULL,
	`publishMode` text DEFAULT 'host' NOT NULL,
	`targetPort` integer NOT NULL,
	`protocol` text NOT NULL,
	`applicationId` text NOT NULL,
	FOREIGN KEY (`applicationId`) REFERENCES `application`(`applicationId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `postgres` (
	`postgresId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`appName` text NOT NULL,
	`databaseName` text NOT NULL,
	`databaseUser` text NOT NULL,
	`databasePassword` text NOT NULL,
	`description` text,
	`dockerImage` text NOT NULL,
	`command` text,
	`args` text,
	`env` text,
	`memoryReservation` text,
	`externalPort` integer,
	`memoryLimit` text,
	`cpuReservation` text,
	`cpuLimit` text,
	`applicationStatus` text DEFAULT 'idle' NOT NULL,
	`healthCheckSwarm` text,
	`restartPolicySwarm` text,
	`placementSwarm` text,
	`updateConfigSwarm` text,
	`rollbackConfigSwarm` text,
	`modeSwarm` text,
	`labelsSwarm` text,
	`networkSwarm` text,
	`stopGracePeriodSwarm` blob,
	`endpointSpecSwarm` text,
	`ulimitsSwarm` text,
	`replicas` integer DEFAULT 1 NOT NULL,
	`createdAt` text NOT NULL,
	`environmentId` text NOT NULL,
	`serverId` text,
	FOREIGN KEY (`environmentId`) REFERENCES `environment`(`environmentId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`serverId`) REFERENCES `server`(`serverId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `postgres_appName_unique` ON `postgres` (`appName`);--> statement-breakpoint
CREATE TABLE `preview_deployments` (
	`previewDeploymentId` text PRIMARY KEY NOT NULL,
	`branch` text NOT NULL,
	`pullRequestId` text NOT NULL,
	`pullRequestNumber` text NOT NULL,
	`pullRequestURL` text NOT NULL,
	`pullRequestTitle` text NOT NULL,
	`pullRequestCommentId` text NOT NULL,
	`previewStatus` text DEFAULT 'idle' NOT NULL,
	`appName` text NOT NULL,
	`applicationId` text NOT NULL,
	`domainId` text,
	`createdAt` text NOT NULL,
	`expiresAt` text,
	FOREIGN KEY (`applicationId`) REFERENCES `application`(`applicationId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domainId`) REFERENCES `domain`(`domainId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preview_deployments_appName_unique` ON `preview_deployments` (`appName`);--> statement-breakpoint
CREATE TABLE `project` (
	`projectId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`createdAt` text NOT NULL,
	`organizationId` text NOT NULL,
	`env` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `redirect` (
	`redirectId` text PRIMARY KEY NOT NULL,
	`regex` text NOT NULL,
	`replacement` text NOT NULL,
	`permanent` integer DEFAULT false NOT NULL,
	`uniqueConfigKey` integer NOT NULL,
	`createdAt` text NOT NULL,
	`applicationId` text NOT NULL,
	FOREIGN KEY (`applicationId`) REFERENCES `application`(`applicationId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `redis` (
	`redisId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`appName` text NOT NULL,
	`description` text,
	`password` text NOT NULL,
	`dockerImage` text NOT NULL,
	`command` text,
	`args` text,
	`env` text,
	`memoryReservation` text,
	`memoryLimit` text,
	`cpuReservation` text,
	`cpuLimit` text,
	`externalPort` integer,
	`createdAt` text NOT NULL,
	`applicationStatus` text DEFAULT 'idle' NOT NULL,
	`healthCheckSwarm` text,
	`restartPolicySwarm` text,
	`placementSwarm` text,
	`updateConfigSwarm` text,
	`rollbackConfigSwarm` text,
	`modeSwarm` text,
	`labelsSwarm` text,
	`networkSwarm` text,
	`stopGracePeriodSwarm` blob,
	`endpointSpecSwarm` text,
	`ulimitsSwarm` text,
	`replicas` integer DEFAULT 1 NOT NULL,
	`environmentId` text NOT NULL,
	`serverId` text,
	FOREIGN KEY (`environmentId`) REFERENCES `environment`(`environmentId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`serverId`) REFERENCES `server`(`serverId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `redis_appName_unique` ON `redis` (`appName`);--> statement-breakpoint
CREATE TABLE `registry` (
	`registryId` text PRIMARY KEY NOT NULL,
	`registryName` text NOT NULL,
	`imagePrefix` text,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`registryUrl` text DEFAULT '' NOT NULL,
	`createdAt` text NOT NULL,
	`selfHosted` text DEFAULT 'cloud' NOT NULL,
	`organizationId` text NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rollback` (
	`rollbackId` text PRIMARY KEY NOT NULL,
	`deploymentId` text NOT NULL,
	`version` integer,
	`image` text,
	`createdAt` text NOT NULL,
	`fullContext` text,
	FOREIGN KEY (`deploymentId`) REFERENCES `deployment`(`deploymentId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `schedule` (
	`scheduleId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`cronExpression` text NOT NULL,
	`appName` text NOT NULL,
	`serviceName` text,
	`shellType` text DEFAULT 'bash' NOT NULL,
	`scheduleType` text DEFAULT 'application' NOT NULL,
	`command` text NOT NULL,
	`script` text,
	`applicationId` text,
	`composeId` text,
	`serverId` text,
	`userId` text,
	`enabled` integer DEFAULT true NOT NULL,
	`timezone` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`applicationId`) REFERENCES `application`(`applicationId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`composeId`) REFERENCES `compose`(`composeId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`serverId`) REFERENCES `server`(`serverId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `security` (
	`securityId` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`createdAt` text NOT NULL,
	`applicationId` text NOT NULL,
	FOREIGN KEY (`applicationId`) REFERENCES `application`(`applicationId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `security_username_applicationId_unique` ON `security` (`username`,`applicationId`);--> statement-breakpoint
CREATE TABLE `server` (
	`serverId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`ipAddress` text NOT NULL,
	`port` integer NOT NULL,
	`username` text DEFAULT 'root' NOT NULL,
	`appName` text NOT NULL,
	`enableDockerCleanup` integer DEFAULT false NOT NULL,
	`createdAt` text NOT NULL,
	`organizationId` text NOT NULL,
	`serverStatus` text DEFAULT 'active' NOT NULL,
	`serverType` text DEFAULT 'deploy' NOT NULL,
	`command` text DEFAULT '' NOT NULL,
	`sshKeyId` text,
	`metricsConfig` text DEFAULT '{"server":{"type":"Remote","refreshRate":60,"port":4500,"token":"","urlCallback":"","cronJob":"","retentionDays":2,"thresholds":{"cpu":0,"memory":0}},"containers":{"refreshRate":60,"services":{"include":[],"exclude":[]}}}' NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sshKeyId`) REFERENCES `ssh-key`(`sshKeyId`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`impersonated_by` text,
	`active_organization_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `ssh-key` (
	`sshKeyId` text PRIMARY KEY NOT NULL,
	`privateKey` text DEFAULT '' NOT NULL,
	`publicKey` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`createdAt` text NOT NULL,
	`lastUsedAt` text,
	`organizationId` text NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sso_provider` (
	`id` text PRIMARY KEY NOT NULL,
	`issuer` text NOT NULL,
	`oidc_config` text,
	`saml_config` text,
	`provider_id` text NOT NULL,
	`user_id` text,
	`organization_id` text,
	`domain` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sso_provider_provider_id_unique` ON `sso_provider` (`provider_id`);--> statement-breakpoint
CREATE TABLE `project_tag` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`tagId` text NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `project`(`projectId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tagId`) REFERENCES `tag`(`tagId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_project_tag` ON `project_tag` (`projectId`,`tagId`);--> statement-breakpoint
CREATE TABLE `tag` (
	`tagId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`createdAt` text NOT NULL,
	`organizationId` text NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_org_tag_name` ON `tag` (`organizationId`,`name`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`firstName` text DEFAULT '' NOT NULL,
	`lastName` text DEFAULT '' NOT NULL,
	`isRegistered` integer DEFAULT false NOT NULL,
	`expirationDate` text NOT NULL,
	`createdAt` text NOT NULL,
	`created_at` integer,
	`two_factor_enabled` integer,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`image` text,
	`banned` integer,
	`ban_reason` text,
	`ban_expires` integer,
	`updated_at` integer NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`enablePaidFeatures` integer DEFAULT false NOT NULL,
	`allowImpersonation` integer DEFAULT false NOT NULL,
	`enableEnterpriseFeatures` integer DEFAULT true NOT NULL,
	`licenseKey` text,
	`isValidEnterpriseLicense` integer DEFAULT true NOT NULL,
	`stripeCustomerId` text,
	`stripeSubscriptionId` text,
	`serversQuantity` integer DEFAULT 0 NOT NULL,
	`trustedOrigins` text,
	`bookmarkedTemplates` text DEFAULT '[]'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `volume_backup` (
	`volumeBackupId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`volumeName` text NOT NULL,
	`prefix` text NOT NULL,
	`serviceType` text DEFAULT 'application' NOT NULL,
	`appName` text NOT NULL,
	`serviceName` text,
	`turnOff` integer DEFAULT false NOT NULL,
	`cronExpression` text NOT NULL,
	`keepLatestCount` integer,
	`enabled` integer,
	`applicationId` text,
	`postgresId` text,
	`mariadbId` text,
	`mongoId` text,
	`mysqlId` text,
	`redisId` text,
	`composeId` text,
	`libsqlId` text,
	`createdAt` text NOT NULL,
	`destinationId` text NOT NULL,
	FOREIGN KEY (`applicationId`) REFERENCES `application`(`applicationId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`postgresId`) REFERENCES `postgres`(`postgresId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mariadbId`) REFERENCES `mariadb`(`mariadbId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mongoId`) REFERENCES `mongo`(`mongoId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mysqlId`) REFERENCES `mysql`(`mysqlId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`redisId`) REFERENCES `redis`(`redisId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`composeId`) REFERENCES `compose`(`composeId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`libsqlId`) REFERENCES `libsql`(`libsqlId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destinationId`) REFERENCES `destination`(`destinationId`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ai_usage_metrics` (
	`metric_id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`application_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`endpoint` text NOT NULL,
	`byok` integer DEFAULT false NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`provider_cost` text NOT NULL,
	`cost` text NOT NULL,
	`charged` integer DEFAULT false NOT NULL,
	`charged_at` integer,
	`transaction_id` text,
	`request_duration_ms` integer,
	`error_occurred` integer DEFAULT false NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `wallet_transactions`(`transaction_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_usage_metrics_request_id_unique` ON `ai_usage_metrics` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_ai_usage_org` ON `ai_usage_metrics` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_ai_usage_uncharged` ON `ai_usage_metrics` (`charged`);--> statement-breakpoint
CREATE TABLE `app_usage_metrics` (
	`metric_id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`duration_seconds` integer NOT NULL,
	`cpu_seconds` text NOT NULL,
	`memory_gb_seconds` text NOT NULL,
	`storage_gb_seconds` text NOT NULL,
	`egress_gb` text NOT NULL,
	`cpu_cost` text NOT NULL,
	`memory_cost` text NOT NULL,
	`storage_cost` text NOT NULL,
	`egress_cost` text NOT NULL,
	`total_cost` text NOT NULL,
	`charged` integer DEFAULT false NOT NULL,
	`charged_at` integer,
	`transaction_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`applicationId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `wallet_transactions`(`transaction_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_app_usage_app` ON `app_usage_metrics` (`application_id`);--> statement-breakpoint
CREATE INDEX `idx_app_usage_org` ON `app_usage_metrics` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_app_usage_uncharged` ON `app_usage_metrics` (`charged`);--> statement-breakpoint
CREATE TABLE `balance_alert_history` (
	`alert_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`alert_type` text NOT NULL,
	`balance_at_alert` text NOT NULL,
	`threshold` text,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_balance_alerts_user` ON `balance_alert_history` (`user_id`);--> statement-breakpoint
CREATE TABLE `organization_wallet` (
	`wallet_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`balance` text DEFAULT '0' NOT NULL,
	`monthly_credits` text DEFAULT '0' NOT NULL,
	`purchased_credits` text DEFAULT '0' NOT NULL,
	`plan` text DEFAULT 'hobby' NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`subscription_status` text DEFAULT 'active' NOT NULL,
	`auto_topup_enabled` integer DEFAULT false NOT NULL,
	`auto_topup_threshold` text,
	`auto_topup_amount` text,
	`auto_topup_last_triggered` integer,
	`cycle_start` integer NOT NULL,
	`cycle_end` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_wallet_organization_id_unique` ON `organization_wallet` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_org_wallet_org_id` ON `organization_wallet` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_org_wallet_owner` ON `organization_wallet` (`owner_id`);--> statement-breakpoint
CREATE TABLE `wallet_transactions` (
	`transaction_id` text PRIMARY KEY NOT NULL,
	`wallet_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` text NOT NULL,
	`balance_before` text NOT NULL,
	`balance_after` text NOT NULL,
	`stripe_payment_intent_id` text,
	`description` text,
	`application_id` text,
	`ai_request_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `organization_wallet`(`wallet_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_wallet_tx_wallet` ON `wallet_transactions` (`wallet_id`);--> statement-breakpoint
CREATE INDEX `idx_wallet_tx_org` ON `wallet_transactions` (`organization_id`);--> statement-breakpoint
CREATE TABLE `webServerSettings` (
	`id` text PRIMARY KEY NOT NULL,
	`serverIp` text,
	`certificateType` text DEFAULT 'none' NOT NULL,
	`https` integer DEFAULT false NOT NULL,
	`host` text,
	`letsEncryptEmail` text,
	`sshPrivateKey` text,
	`enableDockerCleanup` integer DEFAULT true NOT NULL,
	`logCleanupCron` text DEFAULT '0 0 * * *',
	`metricsConfig` text DEFAULT '{"server":{"type":"Hanzo Platform","refreshRate":60,"port":4500,"token":"","retentionDays":2,"cronJob":"","urlCallback":"","thresholds":{"cpu":0,"memory":0}},"containers":{"refreshRate":60,"services":{"include":[],"exclude":[]}}}' NOT NULL,
	`whitelabelingConfig` text DEFAULT '{"appName":null,"appDescription":null,"logoUrl":null,"faviconUrl":null,"customCss":null,"loginLogoUrl":null,"supportUrl":null,"docsUrl":null,"errorPageTitle":null,"errorPageDescription":null,"metaTitle":null,"footerText":null}',
	`remoteServersOnly` integer DEFAULT false NOT NULL,
	`enforceSSO` integer DEFAULT false NOT NULL,
	`cleanupCacheApplications` integer DEFAULT false NOT NULL,
	`cleanupCacheOnPreviews` integer DEFAULT false NOT NULL,
	`cleanupCacheOnCompose` integer DEFAULT false NOT NULL,
	`created_at` integer,
	`updated_at` integer NOT NULL
);
