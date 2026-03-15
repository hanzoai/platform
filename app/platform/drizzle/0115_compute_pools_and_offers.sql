-- ============================================================================
-- Migration: Compute Pools and Offers
-- Purpose: Add support for decentralized compute marketplace
-- ============================================================================

-- ============================================================================
-- Enums
-- ============================================================================

DO $$ BEGIN
	CREATE TYPE "pool_status" AS ENUM('pending', 'active', 'maintenance', 'suspended', 'decommissioned');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "node_status" AS ENUM('online', 'offline', 'syncing', 'draining', 'maintenance');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "node_type" AS ENUM('validator', 'worker', 'storage', 'gpu', 'inference');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "gpu_vendor" AS ENUM('nvidia', 'amd', 'intel', 'apple');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "offer_status" AS ENUM('draft', 'active', 'paused', 'expired', 'depleted', 'retired');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "pricing_model" AS ENUM('per_hour', 'per_resource_hour', 'spot', 'reserved', 'auction');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "billing_cycle" AS ENUM('hourly', 'daily', 'weekly', 'monthly');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "lease_status" AS ENUM('pending', 'provisioning', 'active', 'suspended', 'terminating', 'terminated', 'failed');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ============================================================================
-- Compute Pool
-- ============================================================================

CREATE TABLE IF NOT EXISTS "compute_pool" (
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
	"config" jsonb DEFAULT '{}',
	"certifications" text[] DEFAULT ARRAY[]::text[],
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_health_check" timestamp with time zone
);
--> statement-breakpoint

-- ============================================================================
-- Compute Node
-- ============================================================================

CREATE TABLE IF NOT EXISTS "compute_node" (
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
	"labels" jsonb DEFAULT '{}',
	"taints" jsonb DEFAULT '[]',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"registered_at" timestamp with time zone
);
--> statement-breakpoint

-- ============================================================================
-- Compute Offer
-- ============================================================================

CREATE TABLE IF NOT EXISTS "compute_offer" (
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
	"sla" jsonb DEFAULT '{}',
	"features" text[] DEFAULT ARRAY[]::text[],
	"restrictions" jsonb DEFAULT '{}',
	"metadata" jsonb,
	"tags" text[] DEFAULT ARRAY[]::text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ============================================================================
-- Compute Lease
-- ============================================================================

CREATE TABLE IF NOT EXISTS "compute_lease" (
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
	"usage_metrics" jsonb DEFAULT '{}',
	"termination_reason" text,
	"terminated_by" text,
	"metadata" jsonb,
	"labels" jsonb DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ============================================================================
-- Compute Usage
-- ============================================================================

CREATE TABLE IF NOT EXISTS "compute_usage" (
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

-- ============================================================================
-- Foreign Keys
-- ============================================================================

DO $$ BEGIN
	ALTER TABLE "compute_pool" ADD CONSTRAINT "compute_pool_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "compute_pool" ADD CONSTRAINT "compute_pool_owner_id_user_temp_id_fk" FOREIGN KEY ("owner_id") REFERENCES "user_temp"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "compute_node" ADD CONSTRAINT "compute_node_pool_id_compute_pool_pool_id_fk" FOREIGN KEY ("pool_id") REFERENCES "compute_pool"("pool_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "compute_offer" ADD CONSTRAINT "compute_offer_pool_id_compute_pool_pool_id_fk" FOREIGN KEY ("pool_id") REFERENCES "compute_pool"("pool_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "compute_lease" ADD CONSTRAINT "compute_lease_offer_id_compute_offer_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "compute_offer"("offer_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "compute_lease" ADD CONSTRAINT "compute_lease_pool_id_compute_pool_pool_id_fk" FOREIGN KEY ("pool_id") REFERENCES "compute_pool"("pool_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "compute_lease" ADD CONSTRAINT "compute_lease_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "compute_lease" ADD CONSTRAINT "compute_lease_user_id_user_temp_id_fk" FOREIGN KEY ("user_id") REFERENCES "user_temp"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "compute_lease" ADD CONSTRAINT "compute_lease_node_id_compute_node_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "compute_node"("node_id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "compute_lease" ADD CONSTRAINT "compute_lease_wallet_id_organization_wallet_wallet_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "organization_wallet"("wallet_id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "compute_usage" ADD CONSTRAINT "compute_usage_lease_id_compute_lease_lease_id_fk" FOREIGN KEY ("lease_id") REFERENCES "compute_lease"("lease_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "compute_usage" ADD CONSTRAINT "compute_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "compute_usage" ADD CONSTRAINT "compute_usage_offer_id_compute_offer_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "compute_offer"("offer_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "compute_usage" ADD CONSTRAINT "compute_usage_transaction_id_wallet_transactions_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "wallet_transactions"("transaction_id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS "idx_compute_pool_org" ON "compute_pool" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_compute_pool_status" ON "compute_pool" ("status");
CREATE INDEX IF NOT EXISTS "idx_compute_pool_region" ON "compute_pool" ("primary_region");
CREATE INDEX IF NOT EXISTS "idx_compute_pool_slug" ON "compute_pool" ("slug");
CREATE INDEX IF NOT EXISTS "idx_compute_pool_network" ON "compute_pool" ("network_address");

CREATE INDEX IF NOT EXISTS "idx_compute_node_pool" ON "compute_node" ("pool_id");
CREATE INDEX IF NOT EXISTS "idx_compute_node_status" ON "compute_node" ("status");
CREATE INDEX IF NOT EXISTS "idx_compute_node_type" ON "compute_node" ("node_type");
CREATE INDEX IF NOT EXISTS "idx_compute_node_region" ON "compute_node" ("region");
CREATE INDEX IF NOT EXISTS "idx_compute_node_network" ON "compute_node" ("network_address");
CREATE INDEX IF NOT EXISTS "idx_compute_node_heartbeat" ON "compute_node" ("last_heartbeat");

CREATE INDEX IF NOT EXISTS "idx_compute_offer_pool" ON "compute_offer" ("pool_id");
CREATE INDEX IF NOT EXISTS "idx_compute_offer_status" ON "compute_offer" ("status");
CREATE INDEX IF NOT EXISTS "idx_compute_offer_pricing" ON "compute_offer" ("pricing_model");
CREATE INDEX IF NOT EXISTS "idx_compute_offer_slug" ON "compute_offer" ("slug");
CREATE INDEX IF NOT EXISTS "idx_compute_offer_price" ON "compute_offer" ("base_price");
CREATE INDEX IF NOT EXISTS "idx_compute_offer_capacity" ON "compute_offer" ("available_capacity");

CREATE INDEX IF NOT EXISTS "idx_compute_lease_offer" ON "compute_lease" ("offer_id");
CREATE INDEX IF NOT EXISTS "idx_compute_lease_pool" ON "compute_lease" ("pool_id");
CREATE INDEX IF NOT EXISTS "idx_compute_lease_org" ON "compute_lease" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_compute_lease_user" ON "compute_lease" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_compute_lease_node" ON "compute_lease" ("node_id");
CREATE INDEX IF NOT EXISTS "idx_compute_lease_status" ON "compute_lease" ("status");
CREATE INDEX IF NOT EXISTS "idx_compute_lease_wallet" ON "compute_lease" ("wallet_id");
CREATE INDEX IF NOT EXISTS "idx_compute_lease_expires" ON "compute_lease" ("expires_at");
CREATE INDEX IF NOT EXISTS "idx_compute_lease_network" ON "compute_lease" ("network_lease_id");

CREATE INDEX IF NOT EXISTS "idx_compute_usage_lease" ON "compute_usage" ("lease_id");
CREATE INDEX IF NOT EXISTS "idx_compute_usage_org" ON "compute_usage" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_compute_usage_period" ON "compute_usage" ("period_start", "period_end");
CREATE INDEX IF NOT EXISTS "idx_compute_usage_uncharged" ON "compute_usage" ("charged") WHERE charged = false;

-- ============================================================================
-- Unique Constraints
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS "idx_compute_pool_org_slug" ON "compute_pool" ("organization_id", "slug");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_compute_offer_pool_slug" ON "compute_offer" ("pool_id", "slug");

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE "compute_pool" IS 'Compute pools represent collections of compute resources provided by operators on the Hanzo Network';
COMMENT ON TABLE "compute_node" IS 'Individual compute nodes that belong to a pool and provide actual resources';
COMMENT ON TABLE "compute_offer" IS 'Pricing and configuration for compute resources available for lease';
COMMENT ON TABLE "compute_lease" IS 'Active leases of compute resources by consumers';
COMMENT ON TABLE "compute_usage" IS 'Granular usage records for billing compute consumption';

COMMENT ON COLUMN "compute_pool"."network_address" IS 'On-chain address for this pool on Hanzo Network';
COMMENT ON COLUMN "compute_pool"."peer_id" IS 'libp2p peer ID for network discovery';
COMMENT ON COLUMN "compute_node"."health_score" IS 'Computed health score from 0-100 based on uptime, performance, and reliability';
COMMENT ON COLUMN "compute_offer"."resource_spec" IS 'JSON specification of resources provided by this offer';
COMMENT ON COLUMN "compute_offer"."sla" IS 'Service level agreement terms including uptime guarantees';
COMMENT ON COLUMN "compute_lease"."pricing_snapshot" IS 'Snapshot of pricing at lease creation time, used for billing';
COMMENT ON COLUMN "compute_lease"."network_tx_hash" IS 'Blockchain transaction hash that created this lease';
