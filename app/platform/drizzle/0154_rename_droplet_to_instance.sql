-- Migration: Rename droplet -> instance for multi-cloud genericity
-- Description: Renames provisioned_droplet table and columns to use
--              provider-agnostic "instance" terminology.

-- ============================================================================
-- Rename enum type
-- ============================================================================

ALTER TYPE "droplet_status" RENAME TO "instance_status";

-- ============================================================================
-- Rename table
-- ============================================================================

ALTER TABLE "provisioned_droplet" RENAME TO "provisioned_instance";

-- ============================================================================
-- Rename primary key column
-- ============================================================================

ALTER TABLE "provisioned_instance" RENAME COLUMN "droplet_id" TO "instance_id";

-- ============================================================================
-- Rename indexes
-- ============================================================================

ALTER INDEX "idx_provisioned_droplet_provider" RENAME TO "idx_provisioned_instance_provider";
ALTER INDEX "idx_provisioned_droplet_pool" RENAME TO "idx_provisioned_instance_pool";
ALTER INDEX "idx_provisioned_droplet_node" RENAME TO "idx_provisioned_instance_node";
ALTER INDEX "idx_provisioned_droplet_status" RENAME TO "idx_provisioned_instance_status";
ALTER INDEX "idx_provisioned_droplet_external" RENAME TO "idx_provisioned_instance_external";

-- ============================================================================
-- Rename foreign key constraints
-- ============================================================================

ALTER TABLE "provisioned_instance" RENAME CONSTRAINT "provisioned_droplet_cloud_provider_id_cloud_provider_provider_id_fk"
    TO "provisioned_instance_cloud_provider_id_cloud_provider_provider_id_fk";
ALTER TABLE "provisioned_instance" RENAME CONSTRAINT "provisioned_droplet_pool_id_compute_pool_pool_id_fk"
    TO "provisioned_instance_pool_id_compute_pool_pool_id_fk";
ALTER TABLE "provisioned_instance" RENAME CONSTRAINT "provisioned_droplet_compute_node_id_compute_node_node_id_fk"
    TO "provisioned_instance_compute_node_id_compute_node_node_id_fk";
