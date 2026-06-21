DO $$ BEGIN CREATE TYPE "public"."cloud_provider_type" AS ENUM('digitalocean', 'aws', 'gcp', 'azure', 'hetzner', 'vultr', 'linode'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."droplet_status" AS ENUM('pending', 'provisioning', 'booting', 'registering', 'running', 'draining', 'stopping', 'terminated', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."gpu_vendor" AS ENUM('nvidia', 'amd', 'intel', 'apple'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."node_status" AS ENUM('online', 'offline', 'syncing', 'draining', 'maintenance'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."node_type" AS ENUM('validator', 'worker', 'storage', 'gpu', 'inference'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."pool_status" AS ENUM('pending', 'active', 'maintenance', 'suspended', 'decommissioned'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."billing_cycle" AS ENUM('hourly', 'daily', 'weekly', 'monthly'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."lease_status" AS ENUM('pending', 'provisioning', 'active', 'suspended', 'terminating', 'terminated', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."offer_status" AS ENUM('draft', 'active', 'paused', 'expired', 'depleted', 'retired'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."pricing_model" AS ENUM('per_hour', 'per_resource_hour', 'spot', 'reserved', 'auction'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."doksClusterStatus" AS ENUM('pending', 'provisioning', 'running', 'error', 'deleting', 'deleted'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE TABLE "billing_record" (
	"billingId" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"doksClusterId" text,
	"monthlyTotal" real DEFAULT 0 NOT NULL,
	"subtotal" real DEFAULT 0 NOT NULL,
	"markup" real DEFAULT 0 NOT NULL,
	"markupPercent" real DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"calculatedAt" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cloud_provider" (
	"provider_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider_type" "cloud_provider_type" NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"credentials" jsonb NOT NULL,
	"default_region" text DEFAULT 'nyc1' NOT NULL,
	"default_size" text DEFAULT 's-2vcpu-4gb' NOT NULL,
	"default_image" text DEFAULT 'ubuntu-22-04-x64' NOT NULL,
	"vpc_config" jsonb,
	"ssh_key_ids" text[] DEFAULT ARRAY[]::text[],
	"firewall_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_validated" timestamp with time zone,
	"validation_error" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provisioned_droplet" (
	"droplet_id" text PRIMARY KEY NOT NULL,
	"cloud_provider_id" text NOT NULL,
	"pool_id" text,
	"compute_node_id" text,
	"external_id" text,
	"external_name" text NOT NULL,
	"region" text NOT NULL,
	"size" text NOT NULL,
	"image" text NOT NULL,
	"vpc_id" text,
	"status" "droplet_status" DEFAULT 'pending' NOT NULL,
	"public_ip" text,
	"private_ip" text,
	"public_ipv6" text,
	"registration_token" text,
	"registration_expiry" timestamp with time zone,
	"swarm_join_token" text,
	"cpu_cores" integer NOT NULL,
	"memory_mb" integer NOT NULL,
	"storage_gb" integer NOT NULL,
	"gpu_count" integer DEFAULT 0,
	"hourly_price" text,
	"monthly_price" text,
	"tags" text[] DEFAULT ARRAY[]::text[],
	"last_error" text,
	"error_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provisioned_at" timestamp with time zone,
	"registered_at" timestamp with time zone,
	"terminated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scaling_job" (
	"job_id" text PRIMARY KEY NOT NULL,
	"pool_id" text NOT NULL,
	"cloud_provider_id" text NOT NULL,
	"job_type" text NOT NULL,
	"config" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"created_node_ids" text[] DEFAULT ARRAY[]::text[],
	"removed_node_ids" text[] DEFAULT ARRAY[]::text[],
	"error" text,
	"error_details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "compute_node" (
	"node_id" text PRIMARY KEY NOT NULL,
	"pool_id" text NOT NULL,
	"name" text NOT NULL,
	"hostname" text,
	"network_address" text,
	"peer_id" text,
	"ip_address" text,
	"port" integer DEFAULT 4500,
	"node_type" "node_type" DEFAULT 'worker' NOT NULL,
	"status" "node_status" DEFAULT 'offline' NOT NULL,
	"region" text NOT NULL,
	"datacenter" text,
	"availability_zone" text,
	"cpu_cores" integer NOT NULL,
	"cpu_model" text,
	"cpu_architecture" text DEFAULT 'x86_64',
	"cpu_frequency_mhz" integer,
	"memory_mb" integer NOT NULL,
	"memory_type" text,
	"storage_gb" integer NOT NULL,
	"storage_type" text,
	"storage_iops" integer,
	"gpu_count" integer DEFAULT 0,
	"gpu_vendor" "gpu_vendor",
	"gpu_model" text,
	"gpu_memory_mb" integer,
	"gpu_compute_capability" text,
	"network_bandwidth_mbps" integer DEFAULT 1000,
	"cpu_utilization_percent" numeric(5, 2) DEFAULT '0',
	"memory_utilization_percent" numeric(5, 2) DEFAULT '0',
	"storage_utilization_percent" numeric(5, 2) DEFAULT '0',
	"gpu_utilization_percent" numeric(5, 2) DEFAULT '0',
	"uptime_seconds" integer DEFAULT 0,
	"last_heartbeat" timestamp with time zone,
	"health_score" numeric(5, 2) DEFAULT '100',
	"os_version" text,
	"runtime_version" text,
	"agent_version" text,
	"labels" jsonb DEFAULT '{}'::jsonb,
	"taints" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"registered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "compute_pool" (
	"pool_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"network_address" text,
	"peer_id" text,
	"status" "pool_status" DEFAULT 'pending' NOT NULL,
	"regions" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"primary_region" text,
	"total_cpu_cores" integer DEFAULT 0 NOT NULL,
	"total_memory_mb" integer DEFAULT 0 NOT NULL,
	"total_storage_gb" integer DEFAULT 0 NOT NULL,
	"total_gpu_count" integer DEFAULT 0 NOT NULL,
	"available_cpu_cores" integer DEFAULT 0 NOT NULL,
	"available_memory_mb" integer DEFAULT 0 NOT NULL,
	"available_storage_gb" integer DEFAULT 0 NOT NULL,
	"available_gpu_count" integer DEFAULT 0 NOT NULL,
	"total_nodes" integer DEFAULT 0 NOT NULL,
	"active_nodes" integer DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"certifications" text[] DEFAULT ARRAY[]::text[],
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_health_check" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "compute_lease" (
	"lease_id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"pool_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"node_id" text,
	"name" text NOT NULL,
	"status" "lease_status" DEFAULT 'pending' NOT NULL,
	"network_tx_hash" text,
	"network_lease_id" text,
	"allocated_resources" jsonb NOT NULL,
	"pricing_snapshot" jsonb NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provisioned_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"terminated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"requested_duration_minutes" integer,
	"actual_duration_seconds" integer DEFAULT 0,
	"billed_amount" numeric(12, 6) DEFAULT '0',
	"last_billed_at" timestamp with time zone,
	"wallet_id" uuid,
	"access_credentials" jsonb,
	"connection_info" jsonb,
	"usage_metrics" jsonb DEFAULT '{}'::jsonb,
	"termination_reason" text,
	"terminated_by" text,
	"metadata" jsonb,
	"labels" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compute_offer" (
	"offer_id" text PRIMARY KEY NOT NULL,
	"pool_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"slug" text NOT NULL,
	"status" "offer_status" DEFAULT 'draft' NOT NULL,
	"resource_spec" jsonb NOT NULL,
	"pricing_model" "pricing_model" DEFAULT 'per_hour' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"base_price" numeric(12, 6) NOT NULL,
	"price_per_cpu_hour" numeric(10, 6),
	"price_per_gb_memory_hour" numeric(10, 6),
	"price_per_gb_storage_hour" numeric(10, 6),
	"price_per_gpu_hour" numeric(10, 6),
	"price_per_gb_egress" numeric(10, 6),
	"billing_cycle" "billing_cycle" DEFAULT 'hourly' NOT NULL,
	"minimum_billing_minutes" integer DEFAULT 60,
	"spot_discount" numeric(5, 2),
	"reserved_discount" numeric(5, 2),
	"annual_discount" numeric(5, 2),
	"total_capacity" integer DEFAULT 1 NOT NULL,
	"used_capacity" integer DEFAULT 0 NOT NULL,
	"available_capacity" integer DEFAULT 1 NOT NULL,
	"min_lease_duration_minutes" integer DEFAULT 60,
	"max_lease_duration_days" integer DEFAULT 365,
	"max_concurrent_leases_per_org" integer DEFAULT 10,
	"valid_from" timestamp with time zone DEFAULT now(),
	"valid_until" timestamp with time zone,
	"sla" jsonb DEFAULT '{}'::jsonb,
	"features" text[] DEFAULT ARRAY[]::text[],
	"restrictions" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb,
	"tags" text[] DEFAULT ARRAY[]::text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compute_usage" (
	"usage_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lease_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"offer_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"cpu_seconds" numeric(12, 6) DEFAULT '0' NOT NULL,
	"memory_gb_seconds" numeric(12, 6) DEFAULT '0' NOT NULL,
	"storage_gb_seconds" numeric(12, 6) DEFAULT '0' NOT NULL,
	"gpu_seconds" numeric(12, 6) DEFAULT '0' NOT NULL,
	"egress_gb" numeric(12, 6) DEFAULT '0' NOT NULL,
	"cpu_cost" numeric(10, 6) DEFAULT '0' NOT NULL,
	"memory_cost" numeric(10, 6) DEFAULT '0' NOT NULL,
	"storage_cost" numeric(10, 6) DEFAULT '0' NOT NULL,
	"gpu_cost" numeric(10, 6) DEFAULT '0' NOT NULL,
	"egress_cost" numeric(10, 6) DEFAULT '0' NOT NULL,
	"base_cost" numeric(10, 6) DEFAULT '0' NOT NULL,
	"total_cost" numeric(10, 6) DEFAULT '0' NOT NULL,
	"charged" boolean DEFAULT false NOT NULL,
	"charged_at" timestamp with time zone,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doks_cluster" (
	"doksClusterId" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"doClusterId" text,
	"region" text DEFAULT 'sfo3' NOT NULL,
	"status" "doksClusterStatus" DEFAULT 'pending' NOT NULL,
	"endpoint" text,
	"k8sVersion" text DEFAULT '1.34.1-do.3',
	"ha" boolean DEFAULT false NOT NULL,
	"autoUpgrade" boolean DEFAULT true NOT NULL,
	"surgeUpgrade" boolean DEFAULT true NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"maintenancePolicy" jsonb DEFAULT '{"startTime":"04:00","day":"sunday"}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "doks_node_pool" (
	"poolId" text PRIMARY KEY NOT NULL,
	"doPoolId" text,
	"name" text NOT NULL,
	"size" text DEFAULT 's-2vcpu-4gb' NOT NULL,
	"count" integer DEFAULT 2 NOT NULL,
	"minNodes" integer DEFAULT 1 NOT NULL,
	"maxNodes" integer DEFAULT 6 NOT NULL,
	"autoScale" boolean DEFAULT true NOT NULL,
	"doksClusterId" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_metrics" (
	"metric_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"application_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"endpoint" text NOT NULL,
	"byok" boolean DEFAULT false NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"provider_cost" numeric(10, 6) NOT NULL,
	"cost" numeric(10, 6) NOT NULL,
	"charged" boolean DEFAULT false NOT NULL,
	"charged_at" timestamp with time zone,
	"transaction_id" uuid,
	"request_duration_ms" integer,
	"error_occurred" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_metrics_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "app_usage_metrics" (
	"metric_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"cpu_seconds" numeric(12, 6) NOT NULL,
	"memory_gb_seconds" numeric(12, 6) NOT NULL,
	"storage_gb_seconds" numeric(12, 6) NOT NULL,
	"egress_gb" numeric(12, 6) NOT NULL,
	"cpu_cost" numeric(10, 6) NOT NULL,
	"memory_cost" numeric(10, 6) NOT NULL,
	"storage_cost" numeric(10, 6) NOT NULL,
	"egress_cost" numeric(10, 6) NOT NULL,
	"total_cost" numeric(10, 6) NOT NULL,
	"charged" boolean DEFAULT false NOT NULL,
	"charged_at" timestamp with time zone,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "balance_alert_history" (
	"alert_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"alert_type" text NOT NULL,
	"balance_at_alert" numeric(10, 2) NOT NULL,
	"threshold" numeric(10, 2),
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_wallet" (
	"wallet_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"balance" numeric(10, 2) DEFAULT '0' NOT NULL,
	"monthly_credits" numeric(10, 2) DEFAULT '0' NOT NULL,
	"purchased_credits" numeric(10, 2) DEFAULT '0' NOT NULL,
	"plan" text DEFAULT 'hobby' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"subscription_status" text DEFAULT 'active' NOT NULL,
	"auto_topup_enabled" boolean DEFAULT false NOT NULL,
	"auto_topup_threshold" numeric(10, 2),
	"auto_topup_amount" numeric(10, 2),
	"auto_topup_last_triggered" timestamp with time zone,
	"cycle_start" timestamp with time zone DEFAULT now() NOT NULL,
	"cycle_end" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_wallet_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"transaction_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"balance_before" numeric(10, 2) NOT NULL,
	"balance_after" numeric(10, 2) NOT NULL,
	"stripe_payment_intent_id" text,
	"description" text,
	"application_id" text,
	"ai_request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_record" ADD CONSTRAINT "billing_record_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_record" ADD CONSTRAINT "billing_record_doksClusterId_doks_cluster_doksClusterId_fk" FOREIGN KEY ("doksClusterId") REFERENCES "public"."doks_cluster"("doksClusterId") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_provider" ADD CONSTRAINT "cloud_provider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioned_droplet" ADD CONSTRAINT "provisioned_droplet_cloud_provider_id_cloud_provider_provider_id_fk" FOREIGN KEY ("cloud_provider_id") REFERENCES "public"."cloud_provider"("provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioned_droplet" ADD CONSTRAINT "provisioned_droplet_pool_id_compute_pool_pool_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."compute_pool"("pool_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioned_droplet" ADD CONSTRAINT "provisioned_droplet_compute_node_id_compute_node_node_id_fk" FOREIGN KEY ("compute_node_id") REFERENCES "public"."compute_node"("node_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scaling_job" ADD CONSTRAINT "scaling_job_pool_id_compute_pool_pool_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."compute_pool"("pool_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scaling_job" ADD CONSTRAINT "scaling_job_cloud_provider_id_cloud_provider_provider_id_fk" FOREIGN KEY ("cloud_provider_id") REFERENCES "public"."cloud_provider"("provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_node" ADD CONSTRAINT "compute_node_pool_id_compute_pool_pool_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."compute_pool"("pool_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_pool" ADD CONSTRAINT "compute_pool_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_pool" ADD CONSTRAINT "compute_pool_owner_id_user_temp_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user_temp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_lease" ADD CONSTRAINT "compute_lease_offer_id_compute_offer_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."compute_offer"("offer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_lease" ADD CONSTRAINT "compute_lease_pool_id_compute_pool_pool_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."compute_pool"("pool_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_lease" ADD CONSTRAINT "compute_lease_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_lease" ADD CONSTRAINT "compute_lease_user_id_user_temp_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_temp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_lease" ADD CONSTRAINT "compute_lease_node_id_compute_node_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."compute_node"("node_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_lease" ADD CONSTRAINT "compute_lease_wallet_id_organization_wallet_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."organization_wallet"("wallet_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_offer" ADD CONSTRAINT "compute_offer_pool_id_compute_pool_pool_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."compute_pool"("pool_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_usage" ADD CONSTRAINT "compute_usage_lease_id_compute_lease_lease_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."compute_lease"("lease_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_usage" ADD CONSTRAINT "compute_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_usage" ADD CONSTRAINT "compute_usage_offer_id_compute_offer_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."compute_offer"("offer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_usage" ADD CONSTRAINT "compute_usage_transaction_id_wallet_transactions_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."wallet_transactions"("transaction_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doks_cluster" ADD CONSTRAINT "doks_cluster_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doks_node_pool" ADD CONSTRAINT "doks_node_pool_doksClusterId_doks_cluster_doksClusterId_fk" FOREIGN KEY ("doksClusterId") REFERENCES "public"."doks_cluster"("doksClusterId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_metrics" ADD CONSTRAINT "ai_usage_metrics_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_metrics" ADD CONSTRAINT "ai_usage_metrics_user_id_user_temp_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_temp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_metrics" ADD CONSTRAINT "ai_usage_metrics_transaction_id_wallet_transactions_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."wallet_transactions"("transaction_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_usage_metrics" ADD CONSTRAINT "app_usage_metrics_application_id_application_applicationId_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("applicationId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_usage_metrics" ADD CONSTRAINT "app_usage_metrics_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_usage_metrics" ADD CONSTRAINT "app_usage_metrics_owner_id_user_temp_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user_temp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_usage_metrics" ADD CONSTRAINT "app_usage_metrics_transaction_id_wallet_transactions_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."wallet_transactions"("transaction_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_alert_history" ADD CONSTRAINT "balance_alert_history_user_id_user_temp_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_temp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_wallet" ADD CONSTRAINT "organization_wallet_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_wallet" ADD CONSTRAINT "organization_wallet_owner_id_user_temp_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user_temp"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_organization_wallet_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."organization_wallet"("wallet_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cloud_provider_org" ON "cloud_provider" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_cloud_provider_type" ON "cloud_provider" USING btree ("provider_type");--> statement-breakpoint
CREATE INDEX "idx_cloud_provider_slug" ON "cloud_provider" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "idx_provisioned_droplet_provider" ON "provisioned_droplet" USING btree ("cloud_provider_id");--> statement-breakpoint
CREATE INDEX "idx_provisioned_droplet_pool" ON "provisioned_droplet" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "idx_provisioned_droplet_node" ON "provisioned_droplet" USING btree ("compute_node_id");--> statement-breakpoint
CREATE INDEX "idx_provisioned_droplet_status" ON "provisioned_droplet" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_provisioned_droplet_external" ON "provisioned_droplet" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "idx_scaling_job_pool" ON "scaling_job" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "idx_scaling_job_status" ON "scaling_job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_compute_node_pool" ON "compute_node" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "idx_compute_node_status" ON "compute_node" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_compute_node_type" ON "compute_node" USING btree ("node_type");--> statement-breakpoint
CREATE INDEX "idx_compute_node_region" ON "compute_node" USING btree ("region");--> statement-breakpoint
CREATE INDEX "idx_compute_node_network" ON "compute_node" USING btree ("network_address");--> statement-breakpoint
CREATE INDEX "idx_compute_node_heartbeat" ON "compute_node" USING btree ("last_heartbeat");--> statement-breakpoint
CREATE INDEX "idx_compute_pool_org" ON "compute_pool" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_compute_pool_status" ON "compute_pool" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_compute_pool_region" ON "compute_pool" USING btree ("primary_region");--> statement-breakpoint
CREATE INDEX "idx_compute_pool_slug" ON "compute_pool" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_compute_pool_network" ON "compute_pool" USING btree ("network_address");--> statement-breakpoint
CREATE INDEX "idx_compute_lease_offer" ON "compute_lease" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "idx_compute_lease_pool" ON "compute_lease" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "idx_compute_lease_org" ON "compute_lease" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_compute_lease_user" ON "compute_lease" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_compute_lease_node" ON "compute_lease" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "idx_compute_lease_status" ON "compute_lease" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_compute_lease_wallet" ON "compute_lease" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "idx_compute_lease_expires" ON "compute_lease" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_compute_lease_network" ON "compute_lease" USING btree ("network_lease_id");--> statement-breakpoint
CREATE INDEX "idx_compute_offer_pool" ON "compute_offer" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "idx_compute_offer_status" ON "compute_offer" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_compute_offer_pricing" ON "compute_offer" USING btree ("pricing_model");--> statement-breakpoint
CREATE INDEX "idx_compute_offer_slug" ON "compute_offer" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_compute_offer_price" ON "compute_offer" USING btree ("base_price");--> statement-breakpoint
CREATE INDEX "idx_compute_offer_capacity" ON "compute_offer" USING btree ("available_capacity");--> statement-breakpoint
CREATE INDEX "idx_compute_usage_lease" ON "compute_usage" USING btree ("lease_id");--> statement-breakpoint
CREATE INDEX "idx_compute_usage_org" ON "compute_usage" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_compute_usage_period" ON "compute_usage" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "idx_compute_usage_uncharged" ON "compute_usage" USING btree ("charged");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_org" ON "ai_usage_metrics" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_uncharged" ON "ai_usage_metrics" USING btree ("charged");--> statement-breakpoint
CREATE INDEX "idx_app_usage_app" ON "app_usage_metrics" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "idx_app_usage_org" ON "app_usage_metrics" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_app_usage_uncharged" ON "app_usage_metrics" USING btree ("charged");--> statement-breakpoint
CREATE INDEX "idx_balance_alerts_user" ON "balance_alert_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_org_wallet_org_id" ON "organization_wallet" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_org_wallet_owner" ON "organization_wallet" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_wallet_tx_wallet" ON "wallet_transactions" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "idx_wallet_tx_org" ON "wallet_transactions" USING btree ("organization_id");