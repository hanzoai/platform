-- Migration: Cloud Provider and DigitalOcean Integration
-- Description: Adds support for managing cloud providers (DO, AWS, GCP, etc.)
--              and tracking provisioned droplets/instances

-- ============================================================================
-- Enums
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE cloud_provider_type AS ENUM (
        'digitalocean',
        'aws',
        'gcp',
        'azure',
        'hetzner',
        'vultr',
        'linode'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE droplet_status AS ENUM (
        'pending',
        'provisioning',
        'booting',
        'registering',
        'running',
        'draining',
        'stopping',
        'terminated',
        'failed'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- Cloud Provider Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS cloud_provider (
    provider_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    provider_type cloud_provider_type NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    credentials JSONB NOT NULL,
    default_region TEXT NOT NULL DEFAULT 'nyc1',
    default_size TEXT NOT NULL DEFAULT 's-2vcpu-4gb',
    default_image TEXT NOT NULL DEFAULT 'ubuntu-22-04-x64',
    vpc_config JSONB,
    ssh_key_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
    firewall_id TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_validated TIMESTAMP WITH TIME ZONE,
    validation_error TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for cloud_provider
CREATE INDEX IF NOT EXISTS idx_cloud_provider_org ON cloud_provider(organization_id);
CREATE INDEX IF NOT EXISTS idx_cloud_provider_type ON cloud_provider(provider_type);
CREATE INDEX IF NOT EXISTS idx_cloud_provider_slug ON cloud_provider(organization_id, slug);

-- Unique constraint: slug must be unique per organization
ALTER TABLE cloud_provider
    ADD CONSTRAINT cloud_provider_org_slug_unique
    UNIQUE (organization_id, slug);

COMMENT ON TABLE cloud_provider IS 'Cloud provider credentials and configuration for auto-provisioning';
COMMENT ON COLUMN cloud_provider.credentials IS 'Encrypted API tokens and credentials (JSON)';
COMMENT ON COLUMN cloud_provider.vpc_config IS 'VPC/network configuration for the provider';

-- ============================================================================
-- Provisioned Droplet Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS provisioned_droplet (
    droplet_id TEXT PRIMARY KEY,
    cloud_provider_id TEXT NOT NULL REFERENCES cloud_provider(provider_id) ON DELETE CASCADE,
    pool_id TEXT REFERENCES compute_pool(pool_id) ON DELETE SET NULL,
    compute_node_id TEXT REFERENCES compute_node(node_id) ON DELETE SET NULL,
    external_id TEXT,
    external_name TEXT NOT NULL,
    region TEXT NOT NULL,
    size TEXT NOT NULL,
    image TEXT NOT NULL,
    vpc_id TEXT,
    status droplet_status NOT NULL DEFAULT 'pending',
    public_ip TEXT,
    private_ip TEXT,
    public_ipv6 TEXT,
    registration_token TEXT,
    registration_expiry TIMESTAMP WITH TIME ZONE,
    swarm_join_token TEXT,
    cpu_cores INTEGER NOT NULL,
    memory_mb INTEGER NOT NULL,
    storage_gb INTEGER NOT NULL,
    gpu_count INTEGER DEFAULT 0,
    hourly_price TEXT,
    monthly_price TEXT,
    tags TEXT[] DEFAULT ARRAY[]::TEXT[],
    last_error TEXT,
    error_count INTEGER NOT NULL DEFAULT 0,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    provisioned_at TIMESTAMP WITH TIME ZONE,
    registered_at TIMESTAMP WITH TIME ZONE,
    terminated_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for provisioned_droplet
CREATE INDEX IF NOT EXISTS idx_provisioned_droplet_provider ON provisioned_droplet(cloud_provider_id);
CREATE INDEX IF NOT EXISTS idx_provisioned_droplet_pool ON provisioned_droplet(pool_id);
CREATE INDEX IF NOT EXISTS idx_provisioned_droplet_node ON provisioned_droplet(compute_node_id);
CREATE INDEX IF NOT EXISTS idx_provisioned_droplet_status ON provisioned_droplet(status);
CREATE INDEX IF NOT EXISTS idx_provisioned_droplet_external ON provisioned_droplet(external_id);

-- Partial index for active droplets (common query pattern)
CREATE INDEX IF NOT EXISTS idx_provisioned_droplet_active
    ON provisioned_droplet(pool_id, status)
    WHERE status = 'running';

COMMENT ON TABLE provisioned_droplet IS 'Tracks cloud instances provisioned through Platform';
COMMENT ON COLUMN provisioned_droplet.external_id IS 'Provider-specific instance ID (DO droplet ID, AWS instance ID, etc.)';
COMMENT ON COLUMN provisioned_droplet.registration_token IS 'One-time token for node bootstrap registration';

-- ============================================================================
-- Scaling Job Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS scaling_job (
    job_id TEXT PRIMARY KEY,
    pool_id TEXT NOT NULL REFERENCES compute_pool(pool_id) ON DELETE CASCADE,
    cloud_provider_id TEXT NOT NULL REFERENCES cloud_provider(provider_id) ON DELETE CASCADE,
    job_type TEXT NOT NULL,
    config JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER NOT NULL DEFAULT 0,
    created_node_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
    removed_node_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
    error TEXT,
    error_details JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for scaling_job
CREATE INDEX IF NOT EXISTS idx_scaling_job_pool ON scaling_job(pool_id);
CREATE INDEX IF NOT EXISTS idx_scaling_job_status ON scaling_job(status);

-- Partial index for active jobs
CREATE INDEX IF NOT EXISTS idx_scaling_job_active
    ON scaling_job(pool_id, status)
    WHERE status IN ('pending', 'running');

COMMENT ON TABLE scaling_job IS 'Tracks async scaling operations (scale up/down, resize)';
COMMENT ON COLUMN scaling_job.config IS 'Job configuration (count, size, region, strategy, etc.)';
COMMENT ON COLUMN scaling_job.progress IS 'Job progress 0-100';

-- ============================================================================
-- Add cloud provider reference to compute_pool (optional)
-- ============================================================================

DO $$ BEGIN
    ALTER TABLE compute_pool
        ADD COLUMN IF NOT EXISTS default_cloud_provider_id TEXT
        REFERENCES cloud_provider(provider_id) ON DELETE SET NULL;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

COMMENT ON COLUMN compute_pool.default_cloud_provider_id IS 'Default cloud provider for auto-scaling this pool';
