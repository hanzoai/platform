# Compute Pools and Offers - Database Schema Design

## Overview

This document describes the database schema for Phase 1 of the Hanzo Platform compute marketplace. The schema enables providers to offer compute resources and consumers to lease them, with full integration into the existing billing system.

## Architecture

```
+------------------+     +------------------+     +------------------+
|   Organization   |     |   ComputePool    |     |   ComputeNode    |
|   (Provider)     |---->|   (Logical)      |---->|   (Physical)     |
+------------------+     +------------------+     +------------------+
                                  |
                                  v
                         +------------------+
                         |  ComputeOffer    |
                         |  (Pricing Tier)  |
                         +------------------+
                                  |
                                  v
+------------------+     +------------------+     +------------------+
|   Organization   |---->|  ComputeLease    |---->|  ComputeUsage    |
|   (Consumer)     |     |  (Active Rental) |     |  (Billing)       |
+------------------+     +------------------+     +------------------+
                                  |
                                  v
                         +------------------+
                         |  OrganizationWallet
                         |  (Payment)       |
                         +------------------+
```

## Tables

### 1. compute_pool

Represents a logical collection of compute resources managed by a provider.

**Key Fields:**
- `pool_id`: Unique identifier (nanoid)
- `organization_id`: Provider organization
- `network_address`: On-chain address for blockchain integration
- `peer_id`: libp2p peer ID for P2P discovery
- `status`: pending, active, maintenance, suspended, decommissioned
- `regions`: Array of supported regions
- `total_*` / `available_*`: Aggregate capacity tracking

**Design Decisions:**
- Pools aggregate capacity from multiple nodes for simpler marketplace browsing
- Network integration fields support both on-chain and P2P discovery
- Capacity fields are denormalized for query performance (updated via triggers/application)

### 2. compute_node

Physical compute resources that belong to a pool.

**Key Fields:**
- `node_id`: Unique identifier
- `pool_id`: Parent pool
- `node_type`: validator, worker, storage, gpu, inference
- `status`: online, offline, syncing, draining, maintenance
- `cpu_cores`, `memory_mb`, `storage_gb`, `gpu_count`: Resource capacity
- `*_utilization_percent`: Current usage metrics
- `health_score`: Computed reliability score (0-100)
- `labels`, `taints`: Kubernetes-style scheduling metadata

**Design Decisions:**
- GPU support is first-class with vendor, model, and compute capability tracking
- Health scoring enables quality-based routing and SLA enforcement
- Labels/taints support sophisticated workload placement

### 3. compute_offer

Pricing and terms for leasing compute resources.

**Key Fields:**
- `offer_id`: Unique identifier
- `pool_id`: Source pool
- `resource_spec`: JSON specification of what you get
- `pricing_model`: per_hour, per_resource_hour, spot, reserved, auction
- `base_price`: Base price per billing cycle
- `price_per_*`: Resource-specific pricing
- `sla`: Uptime guarantees and terms
- `total_capacity` / `available_capacity`: How many can be leased

**Resource Spec Schema:**
```json
{
  "cpuCores": 4,
  "memoryMb": 8192,
  "storageGb": 100,
  "gpuCount": 1,
  "gpuModel": "A100",
  "nodeType": "gpu",
  "regions": ["us-west-1", "us-east-1"]
}
```

**Design Decisions:**
- Multiple pricing models support different use cases (on-demand, spot, reserved)
- Resource spec is flexible JSON to support evolving requirements
- SLA terms are stored for dispute resolution

### 4. compute_lease

Active rental of compute resources by a consumer.

**Key Fields:**
- `lease_id`: Unique identifier
- `offer_id`: Which offer was accepted
- `organization_id`: Consumer organization
- `node_id`: Assigned physical node (nullable until provisioned)
- `status`: pending, provisioning, active, suspended, terminating, terminated, failed
- `network_tx_hash`, `network_lease_id`: Blockchain integration
- `allocated_resources`: Snapshot of what was allocated
- `pricing_snapshot`: Locked pricing at creation time
- `wallet_id`: Payment source

**Design Decisions:**
- Pricing snapshot prevents billing disputes from price changes
- Separate network fields for blockchain settlement
- Connection info stored securely for consumer access

### 5. compute_usage

Granular billing records for compute consumption.

**Key Fields:**
- `usage_id`: UUID primary key
- `lease_id`: Parent lease
- `period_start`, `period_end`: Billing period
- `*_seconds`, `*_cost`: Resource consumption and costs
- `charged`: Whether billed to wallet
- `transaction_id`: Link to wallet transaction

**Design Decisions:**
- Follows existing `app_usage_metrics` and `ai_usage_metrics` patterns
- Enables both real-time and batch billing
- Partial index on `charged = false` for efficient billing queries

## Enums

| Enum | Values |
|------|--------|
| `pool_status` | pending, active, maintenance, suspended, decommissioned |
| `node_status` | online, offline, syncing, draining, maintenance |
| `node_type` | validator, worker, storage, gpu, inference |
| `gpu_vendor` | nvidia, amd, intel, apple |
| `offer_status` | draft, active, paused, expired, depleted, retired |
| `pricing_model` | per_hour, per_resource_hour, spot, reserved, auction |
| `billing_cycle` | hourly, daily, weekly, monthly |
| `lease_status` | pending, provisioning, active, suspended, terminating, terminated, failed |

## Indexes

### Query Optimization
- `idx_compute_pool_org`: Find pools by provider
- `idx_compute_offer_price`: Sort offers by price
- `idx_compute_offer_capacity`: Find available offers
- `idx_compute_lease_status`: Active lease management
- `idx_compute_usage_uncharged`: Efficient billing queries

### Unique Constraints
- `(organization_id, slug)` on pools: Unique pool names per org
- `(pool_id, slug)` on offers: Unique offer names per pool

## Relationships

```
organization 1--* compute_pool
compute_pool 1--* compute_node
compute_pool 1--* compute_offer
compute_offer 1--* compute_lease
compute_lease 1--* compute_usage
compute_lease *--1 organization_wallet
compute_usage *--1 wallet_transactions
```

## Integration Points

### Wallet System
- Leases reference `organization_wallet` for payment
- Usage records reference `wallet_transactions` when charged
- Follows existing billing patterns from `app_usage_metrics`

### Blockchain (hanzo-node)
- `network_address` fields for on-chain identity
- `peer_id` for libp2p discovery
- `network_tx_hash` and `network_lease_id` for settlement

### Existing Platform
- Uses `organization` and `users_temp` from account schema
- Compatible with existing Drizzle ORM patterns
- Follows established naming conventions

## API Schemas (Zod)

The schema files export validated API schemas:

- `apiCreateComputePool`: Create new pool
- `apiRegisterComputeNode`: Register node to pool
- `apiNodeHeartbeat`: Update node metrics
- `apiCreateComputeOffer`: Create pricing offer
- `apiCreateComputeLease`: Lease compute resources
- `apiSearchOffers`: Marketplace search

## Migration

The migration file `0115_compute_pools_and_offers.sql` creates all tables, indexes, and constraints. It follows existing patterns:

1. Create enums with `DO $$ BEGIN ... EXCEPTION ... END $$`
2. Create tables with `CREATE TABLE IF NOT EXISTS`
3. Add foreign keys with same pattern
4. Create indexes with `CREATE INDEX IF NOT EXISTS`
5. Add comments for documentation

## Files Created

| File | Purpose |
|------|---------|
| `/pkg/platform/src/db/schema/compute-pool.ts` | Pool and node tables |
| `/pkg/platform/src/db/schema/compute-offer.ts` | Offer, lease, usage tables |
| `/app/platform/drizzle/0115_compute_pools_and_offers.sql` | SQL migration |
| `/docs/COMPUTE_SCHEMA_DESIGN.md` | This document |

## Next Steps

1. **Phase 2**: Add provider verification and reputation system
2. **Phase 3**: Implement spot pricing and auction mechanisms
3. **Phase 4**: Add SLA monitoring and automatic refunds
4. **Phase 5**: Cross-region replication and failover
