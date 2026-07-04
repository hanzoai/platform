CREATE TABLE `package` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`services` text NOT NULL,
	`brandTemplate` text NOT NULL,
	`iamTemplate` text NOT NULL,
	`domainPattern` text NOT NULL,
	`plan` text DEFAULT 'starter' NOT NULL,
	`sovereign` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tenant_package` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`packageId` text NOT NULL,
	`status` text DEFAULT 'provisioning' NOT NULL,
	`serviceStatuses` text NOT NULL,
	`host` text,
	`iamApp` text,
	`plan` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`packageId`) REFERENCES `package`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_package_unique` ON `tenant_package` (`organizationId`,`packageId`);
--> statement-breakpoint
CREATE TABLE `whitelabel_domain` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text NOT NULL,
	`organizationId` text NOT NULL,
	`serviceName` text DEFAULT 'console' NOT NULL,
	`port` integer DEFAULT 3000 NOT NULL,
	`https` integer DEFAULT true NOT NULL,
	`namespace` text DEFAULT 'hanzo' NOT NULL,
	`cluster` text DEFAULT 'hanzo-k8s' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`dnsCreated` integer DEFAULT false NOT NULL,
	`ingressCreated` integer DEFAULT false NOT NULL,
	`ingressName` text,
	`error` text,
	`tenantPackageId` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whitelabel_domain_host_unique` ON `whitelabel_domain` (`host`);
--> statement-breakpoint
CREATE TABLE `org_brand` (
	`id` text PRIMARY KEY NOT NULL,
	`organizationId` text NOT NULL,
	`brandName` text,
	`iamUrl` text,
	`iamOrgName` text,
	`iamApp` text,
	`logoUrl` text,
	`faviconUrl` text,
	`accentColor` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_brand_organizationId_unique` ON `org_brand` (`organizationId`);
--> statement-breakpoint
CREATE TABLE `service_template` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repo` text,
	`image` text,
	`defaultTag` text,
	`port` integer DEFAULT 3000 NOT NULL,
	`deployable` integer DEFAULT true NOT NULL,
	`buildRequired` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `organization` ADD `parent_org_id` text;
