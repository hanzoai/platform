# ZAP Protocol Integration Design for Hanzo Platform

## Executive Summary

This document outlines the integration of ZAP (Zero-copy Agent Protocol) into Hanzo Platform, enabling high-performance agent control of cloud infrastructure. The integration will support both ZAP-native tools and MCP backwards compatibility during transition.

**Key Benefits:**
- 500x performance improvement for tool calls (sub-microsecond vs 500us for MCP)
- Zero-copy message passing for cloud orchestration commands
- Consensus-backed routing for critical infrastructure operations
- Post-quantum ready signatures for future-proof security
- Unified catalog across all Platform and MCP tools

---

## 1. Architecture Overview

### 1.1 High-Level Architecture

```
                                ZAP Protocol Stack
    +------------------------------------------------------------------+
    |                                                                  |
    |  +------------------+     +-------------------+                  |
    |  |   AI Agents      |     |   Human Operators |                  |
    |  | (Claude, GPT,    |     |   (Console UI,    |                  |
    |  |  Custom Agents)  |     |    CLI tools)     |                  |
    |  +--------+---------+     +--------+----------+                  |
    |           |                        |                             |
    |           v                        v                             |
    |  +--------+------------------------+----------+                  |
    |  |            ZAP Gateway (zapd)              |                  |
    |  |  - Unified Catalog                         |                  |
    |  |  - Consensus-backed routing                |                  |
    |  |  - MCP Gateway (backwards compat)          |                  |
    |  |  - Post-quantum signatures                 |                  |
    |  +--------+-----------------------------------+                  |
    |           |                                                      |
    +-----------|------------------------------------------------------+
                |
    +-----------v----------------------------------------------------------+
    |                    Platform ZAP Server                               |
    |  +-------------------+  +-------------------+  +------------------+  |
    |  | Cloud Interface   |  | Compute Interface |  | Node Interface   |  |
    |  | - Scale up/down   |  | - Pool management |  | - Status         |  |
    |  | - Resize          |  | - Job scheduling  |  | - Drain          |  |
    |  | - Firewall        |  | - Auto-scaling    |  | - Register       |  |
    |  +-------------------+  +-------------------+  +------------------+  |
    |                                                                      |
    |  +-------------------+  +-------------------+  +------------------+  |
    |  | Deploy Interface  |  | Database Interface|  | Monitor Interface|  |
    |  | - Application     |  | - PostgreSQL      |  | - Metrics        |  |
    |  | - Compose         |  | - MySQL           |  | - Alerts         |  |
    |  | - Container       |  | - Redis           |  | - Logs           |  |
    |  +-------------------+  +-------------------+  +------------------+  |
    +-----------+------------------------------------------------------+
                |
    +-----------v--------------+
    |  Infrastructure Layer    |
    |  - DigitalOcean API      |
    |  - Docker Swarm          |
    |  - Lux Network (opt)     |
    +--------------------------+
```

### 1.2 Integration Approaches

We propose a **Hybrid Approach** combining:

1. **Native ZAP Server** - Platform exposes a native ZAP endpoint using Cap'n Proto RPC
2. **zapd Gateway Integration** - Platform registers as a tool provider with the central zapd gateway
3. **MCP Shim** - Existing MCP tools remain accessible via ZAP Gateway's MCP bridge

---

## 2. Cap'n Proto Schema Definitions

### 2.1 Platform-Specific Schema (`platform.zap`)

```capnp
@0xc8d5e9f2b3a47865;

# Platform ZAP Schema
# Extends the base ZAP schema with Platform-specific tools

$import "/schema/zap.zap";

$namespace("ai.hanzo.platform.zap");
$version("1.0.0");
$protocol("capnp-rpc");
$profile("zap-capnp-1");

# ============================================================================
# CLOUD PROVIDER MANAGEMENT
# ============================================================================

struct CloudProvider {
    providerId @0 :Text;
    name @1 :Text;
    slug @2 :Text;
    type @3 :ProviderType;
    status @4 :ProviderStatus;
    defaultRegion @5 :Text;
    defaultSize @6 :Text;
    organizationId @7 :Text;
    createdAt @8 :UInt64;
}

enum ProviderType {
    digitalocean @0;
    aws @1;
    gcp @2;
    azure @3;
    hetzner @4;
}

enum ProviderStatus {
    active @0;
    inactive @1;
    error @2;
    validating @3;
}

struct ConfigureProviderRequest {
    name @0 :Text;
    slug @1 :Text;
    apiToken @2 :Text;
    defaultRegion @3 :Text;
    defaultSize @4 :Text;
    type @5 :ProviderType;
}

# ============================================================================
# SCALING OPERATIONS
# ============================================================================

struct ScaleUpRequest {
    poolId @0 :Text;
    providerId @1 :Text;
    count @2 :UInt32;
    size @3 :Text;          # e.g., "s-2vcpu-4gb"
    region @4 :Text;        # e.g., "nyc1"
    nodeType @5 :NodeType;
    labels @6 :List(Label);
}

struct ScaleDownRequest {
    poolId @0 :Text;
    count @1 :UInt32;
    strategy @2 :ScaleStrategy;
    nodeIds @3 :List(Text);  # Optional: specific nodes to remove
}

enum NodeType {
    worker @0;
    manager @1;
}

enum ScaleStrategy {
    oldest @0;
    newest @1;
    leastUtilized @2;
    specific @3;
}

struct Label {
    key @0 :Text;
    value @1 :Text;
}

struct ScalingJob {
    jobId @0 :Text;
    poolId @1 :Text;
    type @2 :ScalingJobType;
    status @3 :JobStatus;
    targetCount @4 :UInt32;
    completedCount @5 :UInt32;
    failedCount @6 :UInt32;
    createdAt @7 :UInt64;
    updatedAt @8 :UInt64;
    error @9 :Text;
}

enum ScalingJobType {
    scaleUp @0;
    scaleDown @1;
    resize @2;
}

enum JobStatus {
    pending @0;
    inProgress @1;
    completed @2;
    failed @3;
    cancelled @4;
}

# ============================================================================
# NODE MANAGEMENT
# ============================================================================

struct Node {
    nodeId @0 :Text;
    poolId @1 :Text;
    dropletId @2 :Text;
    status @3 :NodeStatus;
    publicIp @4 :Text;
    privateIp @5 :Text;
    hostname @6 :Text;
    size @7 :Text;
    region @8 :Text;
    cpuUtilization @9 :Float64;
    memoryUtilization @10 :Float64;
    createdAt @11 :UInt64;
}

enum NodeStatus {
    provisioning @0;
    bootstrapping @1;
    active @2;
    draining @3;
    terminated @4;
    error @5;
}

struct DrainNodeRequest {
    nodeId @0 :Text;
    force @1 :Bool;
    timeout @2 :UInt64;  # milliseconds
}

struct ResizeDropletRequest {
    dropletId @0 :Text;
    newSize @1 :Text;
    resizeDisk @2 :Bool;
}

# ============================================================================
# COMPUTE POOL MANAGEMENT
# ============================================================================

struct ComputePool {
    poolId @0 :Text;
    name @1 :Text;
    organizationId @2 :Text;
    status @3 :PoolStatus;
    minNodes @4 :UInt32;
    maxNodes @5 :UInt32;
    currentNodes @6 :UInt32;
    targetNodes @7 :UInt32;
    autoScaling @8 :AutoScalingConfig;
}

enum PoolStatus {
    creating @0;
    active @1;
    scaling @2;
    deleting @3;
    error @4;
}

struct AutoScalingConfig {
    enabled @0 :Bool;
    minNodes @1 :UInt32;
    maxNodes @2 :UInt32;
    targetCpuUtilization @3 :Float64;
    targetMemoryUtilization @4 :Float64;
    scaleUpCooldownSeconds @5 :UInt32;
    scaleDownCooldownSeconds @6 :UInt32;
}

# ============================================================================
# INFRASTRUCTURE MANAGEMENT
# ============================================================================

struct CreateFirewallRequest {
    providerId @0 :Text;
    poolId @1 :Text;
    inboundRules @2 :List(FirewallRule);
    outboundRules @3 :List(FirewallRule);
}

struct FirewallRule {
    protocol @0 :Text;  # "tcp", "udp", "icmp"
    ports @1 :Text;     # "80", "443", "8000-9000"
    sources @2 :List(Text);  # CIDR blocks or tags
}

struct CreateLoadBalancerRequest {
    providerId @0 :Text;
    poolId @1 :Text;
    region @2 :Text;
    algorithm @3 :LBAlgorithm;
    healthCheck @4 :HealthCheck;
    forwardingRules @5 :List(ForwardingRule);
}

enum LBAlgorithm {
    roundRobin @0;
    leastConnections @1;
}

struct HealthCheck {
    protocol @0 :Text;
    port @1 :UInt16;
    path @2 :Text;
    checkIntervalSeconds @3 :UInt32;
    responseTimeoutSeconds @4 :UInt32;
    unhealthyThreshold @5 :UInt32;
    healthyThreshold @6 :UInt32;
}

struct ForwardingRule {
    entryProtocol @0 :Text;
    entryPort @1 :UInt16;
    targetProtocol @2 :Text;
    targetPort @3 :UInt16;
    certificateId @4 :Text;
    tlsPassthrough @5 :Bool;
}

# ============================================================================
# APPLICATION DEPLOYMENT
# ============================================================================

struct Application {
    applicationId @0 :Text;
    name @1 :Text;
    projectId @2 :Text;
    serverId @3 :Text;
    status @4 :ApplicationStatus;
    buildType @5 :BuildType;
    dockerImage @6 :Text;
    sourceType @7 :SourceType;
    env @8 :Text;
    replicas @9 :UInt32;
    cpuLimit @10 :Text;
    memoryLimit @11 :Text;
    createdAt @12 :UInt64;
}

enum ApplicationStatus {
    idle @0;
    running @1;
    deploying @2;
    error @3;
    stopped @4;
}

enum BuildType {
    dockerfile @0;
    nixpacks @1;
    buildpacks @2;
    heroku @3;
    docker @4;
}

enum SourceType {
    github @0;
    gitlab @1;
    bitbucket @2;
    git @3;
    dockerImage @4;
}

struct DeployRequest {
    applicationId @0 :Text;
    force @1 :Bool;
}

struct DeployResult {
    deploymentId @0 :Text;
    status @1 :ApplicationStatus;
    logs @2 :Text;
    task @3 :Task;  # For long-running deployment monitoring
}

# ============================================================================
# PLATFORM ZAP INTERFACES
# ============================================================================

interface Cloud {
    # Provider management
    configureProvider @0 (req :ConfigureProviderRequest, ctx :CallContext) -> (provider :CloudProvider)
        $effect(nondeterministic);

    listProviders @1 (ctx :CallContext) -> (providers :List(CloudProvider))
        $effect(deterministic)
        $idempotent(true);

    getProvider @2 (providerId :Text, ctx :CallContext) -> (provider :CloudProvider)
        $effect(deterministic)
        $idempotent(true);

    deleteProvider @3 (providerId :Text, ctx :CallContext) -> (success :Bool)
        $effect(nondeterministic);

    # Resource discovery
    listRegions @4 (providerId :Text, ctx :CallContext) -> (regions :List(Text))
        $effect(deterministic)
        $idempotent(true);

    listSizes @5 (providerId :Text, region :Text, ctx :CallContext) -> (sizes :List(Text))
        $effect(deterministic)
        $idempotent(true);
}

interface Scaling {
    # Scale operations
    scaleUp @0 (req :ScaleUpRequest, ctx :CallContext) -> (job :ScalingJob)
        $effect(nondeterministic)
        $scope(node);

    scaleDown @1 (req :ScaleDownRequest, ctx :CallContext) -> (job :ScalingJob)
        $effect(nondeterministic)
        $scope(node);

    resizeDroplet @2 (req :ResizeDropletRequest, ctx :CallContext) -> (success :Bool)
        $effect(nondeterministic);

    drainNode @3 (req :DrainNodeRequest, ctx :CallContext) -> (success :Bool)
        $effect(nondeterministic);

    # Status
    getScalingJob @4 (jobId :Text, ctx :CallContext) -> (job :ScalingJob)
        $effect(deterministic)
        $idempotent(true);

    listScalingJobs @5 (poolId :Text, ctx :CallContext) -> (jobs :List(ScalingJob))
        $effect(deterministic)
        $idempotent(true);
}

interface Pool {
    # Pool management
    createPool @0 (name :Text, providerId :Text, ctx :CallContext) -> (pool :ComputePool)
        $effect(nondeterministic);

    getPool @1 (poolId :Text, ctx :CallContext) -> (pool :ComputePool)
        $effect(deterministic)
        $idempotent(true);

    listPools @2 (ctx :CallContext) -> (pools :List(ComputePool))
        $effect(deterministic)
        $idempotent(true);

    deletePool @3 (poolId :Text, force :Bool, ctx :CallContext) -> (success :Bool)
        $effect(nondeterministic);

    # Node operations
    listNodes @4 (poolId :Text, ctx :CallContext) -> (nodes :List(Node))
        $effect(deterministic)
        $idempotent(true);

    getNode @5 (nodeId :Text, ctx :CallContext) -> (node :Node)
        $effect(deterministic)
        $idempotent(true);

    # Auto-scaling config
    setAutoScaling @6 (poolId :Text, config :AutoScalingConfig, ctx :CallContext) -> (pool :ComputePool)
        $effect(nondeterministic);

    # Real-time subscription
    subscribeNodeStatus @7 (poolId :Text) -> (stream :EventStream)
        $effect(nondeterministic);
}

interface Infra {
    # Firewall
    createFirewall @0 (req :CreateFirewallRequest, ctx :CallContext) -> (firewallId :Text)
        $effect(nondeterministic);

    updateFirewall @1 (firewallId :Text, rules :List(FirewallRule), ctx :CallContext) -> (success :Bool)
        $effect(nondeterministic);

    deleteFirewall @2 (firewallId :Text, ctx :CallContext) -> (success :Bool)
        $effect(nondeterministic);

    # Load Balancer
    createLoadBalancer @3 (req :CreateLoadBalancerRequest, ctx :CallContext) -> (loadBalancerId :Text)
        $effect(nondeterministic);

    updateLoadBalancer @4 (loadBalancerId :Text, config :CreateLoadBalancerRequest, ctx :CallContext) -> (success :Bool)
        $effect(nondeterministic);

    deleteLoadBalancer @5 (loadBalancerId :Text, ctx :CallContext) -> (success :Bool)
        $effect(nondeterministic);
}

interface Deploy {
    # Application lifecycle
    deploy @0 (req :DeployRequest, ctx :CallContext) -> (result :DeployResult)
        $effect(nondeterministic)
        $scope(node);

    redeploy @1 (applicationId :Text, ctx :CallContext) -> (result :DeployResult)
        $effect(nondeterministic);

    start @2 (applicationId :Text, ctx :CallContext) -> (success :Bool)
        $effect(nondeterministic);

    stop @3 (applicationId :Text, ctx :CallContext) -> (success :Bool)
        $effect(nondeterministic);

    restart @4 (applicationId :Text, ctx :CallContext) -> (success :Bool)
        $effect(nondeterministic);

    # Application info
    getApplication @5 (applicationId :Text, ctx :CallContext) -> (app :Application)
        $effect(deterministic)
        $idempotent(true);

    listApplications @6 (projectId :Text, ctx :CallContext) -> (apps :List(Application))
        $effect(deterministic)
        $idempotent(true);

    # Logs
    getLogs @7 (applicationId :Text, tail :UInt32, ctx :CallContext) -> (logs :Text)
        $effect(deterministic);

    streamLogs @8 (applicationId :Text) -> (stream :EventStream)
        $effect(nondeterministic);
}

# ============================================================================
# TOP-LEVEL PLATFORM ZAP INTERFACE
# ============================================================================

interface Platform {
    # Bootstrap
    initialize @0 (hello :Hello) -> (welcome :Welcome)
        $effect(pure)
        $idempotent(true);

    # Platform-specific capabilities
    cloud @1 () -> (cloud :Cloud) $effect(pure);
    scaling @2 () -> (scaling :Scaling) $effect(pure);
    pool @3 () -> (pool :Pool) $effect(pure);
    infra @4 () -> (infra :Infra) $effect(pure);
    deploy @5 () -> (deploy :Deploy) $effect(pure);

    # Health
    ping @6 () -> (latencyNs :UInt64, serverTime :UInt64)
        $effect(pure)
        $idempotent(true);

    # Catalog registration (for zapd integration)
    getCatalog @7 () -> (tools :List(ToolInfo))
        $effect(deterministic)
        $idempotent(true);
}
```

---

## 3. Implementation Strategy

### 3.1 Phase 1: Native ZAP Server (Week 1-2)

Create a Rust-based ZAP server that wraps Platform's existing tRPC endpoints.

**Directory Structure:**
```
platform/
  pkg/
    zap/                          # New ZAP server package
      Cargo.toml
      build.rs                    # Cap'n Proto compilation
      schema/
        platform.capnp            # Platform schema
      src/
        lib.rs
        server.rs                 # Main ZAP server
        auth.rs                   # Auth middleware
        interfaces/
          mod.rs
          cloud.rs               # Cloud interface impl
          scaling.rs             # Scaling interface impl
          pool.rs                # Pool interface impl
          infra.rs               # Infra interface impl
          deploy.rs              # Deploy interface impl
        trpc_bridge.rs           # Bridge to existing tRPC
        config.rs                # Configuration
```

**Cargo.toml:**
```toml
[package]
name = "platform-zap"
version = "1.0.0"
edition = "2021"

[dependencies]
capnp = "0.19"
capnp-rpc = "0.19"
tokio = { version = "1", features = ["full"] }
tokio-util = "0.7"
futures = "0.3"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.11", features = ["json"] }
thiserror = "1"
async-trait = "0.1"

[build-dependencies]
capnpc = "0.19"
```

### 3.2 Phase 2: tRPC Bridge (Week 2-3)

Bridge ZAP calls to existing tRPC endpoints via HTTP:

```rust
// src/trpc_bridge.rs

use reqwest::Client;
use serde::{Deserialize, Serialize};

pub struct TrpcBridge {
    client: Client,
    base_url: String,
    auth_token: String,
}

impl TrpcBridge {
    pub fn new(base_url: &str, auth_token: &str) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.to_string(),
            auth_token: auth_token.to_string(),
        }
    }

    pub async fn call<I: Serialize, O: for<'de> Deserialize<'de>>(
        &self,
        procedure: &str,
        input: &I,
    ) -> Result<O, BridgeError> {
        let url = format!("{}/v1/trpc/{}", self.base_url, procedure);

        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.auth_token))
            .json(&TrpcInput { input })
            .send()
            .await?;

        let result: TrpcResult<O> = response.json().await?;
        result.into_result()
    }
}

// Example usage in scaling interface:
impl ScalingImpl {
    async fn scale_up(&self, req: ScaleUpRequest, ctx: CallContext) -> Result<ScalingJob> {
        self.bridge.call("digitalocean.scaleUp", &ScaleUpInput {
            pool_id: req.pool_id,
            provider_id: req.provider_id,
            count: req.count,
            size: req.size,
            region: req.region,
            node_type: req.node_type,
            labels: req.labels,
        }).await
    }
}
```

### 3.3 Phase 3: zapd Gateway Registration (Week 3-4)

Register Platform as a tool provider with the central zapd gateway:

**Gateway Configuration (`gateway.toml`):**
```toml
[gateway]
listen = "0.0.0.0"
port = 9999

[[servers]]
name = "platform"
url = "zap://platform.hanzo.ai:9998"
transport = "zap"
timeout = 60000

[servers.auth]
type = "bearer"
token = "${PLATFORM_ZAP_TOKEN}"

# MCP servers for backwards compatibility
[[servers]]
name = "platform-mcp"
url = "http://localhost:3100"
transport = "http"
timeout = 30000
```

### 3.4 Phase 4: MCP Backwards Compatibility (Week 4)

Maintain existing MCP server alongside ZAP:

```typescript
// pkg/mcp/src/zap-shim.ts
// Expose MCP tools via ZAP Gateway

import { createServer as createMcpServer } from './server.js';

export function registerWithZapGateway(zapGatewayUrl: string) {
  // MCP server continues running on :3100
  // zapd Gateway bridges calls automatically

  // For direct MCP clients, nothing changes
  // For ZAP clients, tools appear as mcp.platform.*
}
```

---

## 4. Tool Mapping

### 4.1 tRPC to ZAP Tool Mapping

| tRPC Procedure | ZAP Tool | Effect | Notes |
|---------------|----------|--------|-------|
| `digitalocean.configureProvider` | `cloud.configureProvider` | nondeterministic | Creates provider config |
| `digitalocean.listProviders` | `cloud.listProviders` | deterministic | Read-only |
| `digitalocean.scaleUp` | `scaling.scaleUp` | nondeterministic | Long-running, returns Task |
| `digitalocean.scaleDown` | `scaling.scaleDown` | nondeterministic | Long-running, returns Task |
| `digitalocean.resizeDroplet` | `scaling.resizeDroplet` | nondeterministic | |
| `digitalocean.drainNode` | `scaling.drainNode` | nondeterministic | |
| `digitalocean.listPoolDroplets` | `pool.listNodes` | deterministic | |
| `digitalocean.createFirewall` | `infra.createFirewall` | nondeterministic | |
| `digitalocean.createLoadBalancer` | `infra.createLoadBalancer` | nondeterministic | |
| `application.deploy` | `deploy.deploy` | nondeterministic | Returns Task for progress |
| `application.start` | `deploy.start` | nondeterministic | |
| `application.stop` | `deploy.stop` | nondeterministic | |
| `server.all` | `pool.listPools` | deterministic | |
| `server.setup` | `pool.createPool` | nondeterministic | |

### 4.2 Unified Catalog

Tools are registered in the ZAP catalog with namespaces:

```
platform.cloud.configureProvider
platform.cloud.listProviders
platform.scaling.scaleUp
platform.scaling.scaleDown
platform.pool.listNodes
platform.infra.createFirewall
platform.deploy.deploy
...

# Legacy MCP tools (via gateway)
mcp.platform.project-all
mcp.platform.application-deploy
mcp.platform.postgres-create
...
```

---

## 5. Consensus Integration

### 5.1 Critical Operations with Consensus

For critical infrastructure operations, use Lux consensus:

```rust
// Operations requiring consensus before execution
const CONSENSUS_REQUIRED: &[&str] = &[
    "scaling.scaleDown",      // Removing nodes
    "pool.deletePool",        // Deleting pools
    "infra.deleteFirewall",   // Security changes
    "deploy.deploy",          // Production deployments
];

impl ScalingImpl {
    async fn scale_down_with_consensus(
        &self,
        req: ScaleDownRequest,
        ctx: CallContext
    ) -> Result<ScalingJob> {
        // Get consensus from Lux network
        let cert = self.coordination.propose(
            "platform:scaling:scaleDown",
            &req.to_bytes(),
            ConsensusConfig {
                rounds: 10,
                k: 20,
                alpha: 0.8,
                beta1: 0.85,
                beta2: 0.95,
                timeout_ms: 30000,
            },
            &ctx,
        ).await?;

        // Execute only with certified consensus
        if cert.confidence >= 0.95 {
            self.execute_scale_down(req, cert).await
        } else {
            Err(Error::InsufficientConsensus(cert.confidence))
        }
    }
}
```

### 5.2 Quorum Execution for Multi-Provider

When operating across multiple cloud providers:

```rust
// Execute with 2-of-3 provider agreement
let result = gateway.quorum_execute(
    "platform.scaling.scaleUp",
    &scale_up_request,
    QuorumConfig {
        min_agree: 2,
        providers: vec!["do-primary", "do-secondary", "aws-backup"],
        timeout_ms: 60000,
    },
    &ctx
).await?;
```

---

## 6. Security Model

### 6.1 Capability-Based Security

```rust
// Capabilities are scoped to organization and operations
struct PlatformCapabilities {
    organization_id: String,
    allowed_operations: Vec<Operation>,
    allowed_pools: Vec<String>,
    allowed_providers: Vec<String>,
}

// Attenuated capabilities
fn attenuate_for_readonly(caps: PlatformCapabilities) -> PlatformCapabilities {
    PlatformCapabilities {
        allowed_operations: caps.allowed_operations
            .into_iter()
            .filter(|op| op.is_readonly())
            .collect(),
        ..caps
    }
}
```

### 6.2 Post-Quantum Signatures

Using Dilithium for future-proof signatures:

```rust
use pqcrypto_dilithium::dilithium3;

struct PQSignature {
    public_key: [u8; dilithium3::PUBLICKEYBYTES],
    signature: [u8; dilithium3::SIGNATUREBYTES],
}

impl Auth {
    fn verify_pq(&self, message: &[u8], sig: &PQSignature) -> bool {
        dilithium3::verify(message, &sig.signature, &sig.public_key).is_ok()
    }
}
```

---

## 7. Performance Characteristics

### 7.1 Expected Performance

| Operation | MCP Latency | ZAP Latency | Improvement |
|-----------|------------|-------------|-------------|
| List pools | 450us | <1us | 450x |
| Scale up (initiate) | 500us | 10us | 50x |
| Get node status | 400us | 0.8us | 500x |
| Deploy (initiate) | 600us | 15us | 40x |
| Consensus round | 850ms | 45ms | 19x |

### 7.2 Throughput

| Scenario | MCP (ops/s) | ZAP (ops/s) |
|----------|------------|-------------|
| Status queries | 2,200 | 1,200,000 |
| Mixed operations | 1,800 | 83,000 |
| Consensus operations | 12 | 220 |

---

## 8. Migration Strategy

### 8.1 Phased Rollout

```
Week 1-2: Native ZAP server implementation
Week 3:   tRPC bridge and testing
Week 4:   zapd gateway integration
Week 5:   MCP backwards compatibility verification
Week 6:   Production rollout (ZAP alongside MCP)
Week 7-8: Gradual agent migration to ZAP
Week 9+:  MCP deprecation (optional)
```

### 8.2 Client Migration

```
# Phase 1: Agents use MCP (current)
mcp://platform:3100/

# Phase 2: Agents use ZAP Gateway (MCP tools via bridge)
zap://zapd:9999/  -> mcp.platform.*

# Phase 3: Agents use native ZAP
zap://zapd:9999/  -> platform.*
```

---

## 9. Configuration Reference

### 9.1 Platform ZAP Server Config

```toml
[server]
listen = "0.0.0.0"
port = 9998
log_level = "info"

[auth]
type = "bearer"
secret = "${PLATFORM_ZAP_SECRET}"

[tls]
enabled = true
cert = "/etc/platform/server.crt"
key = "/etc/platform/server.key"

[trpc]
base_url = "http://localhost:3000"
timeout_ms = 60000

[consensus]
enabled = true
endpoint = "zap://lux-node:9000"
min_confidence = 0.95

[catalog]
auto_register = true
gateway_url = "zap://zapd:9999"
```

---

## 10. API Examples

### 10.1 Rust Client

```rust
use hanzo_zap::{Client, platform_capnp};

#[tokio::main]
async fn main() -> zap::Result<()> {
    // Connect to ZAP gateway
    let client = Client::connect("zap://zapd:9999").await?;

    // Get Platform capability
    let platform = client.platform().await?;

    // Scale up a pool
    let scaling = platform.scaling().await?;
    let job = scaling.scale_up(ScaleUpRequest {
        pool_id: "pool-123",
        provider_id: "do-prod",
        count: 3,
        size: "s-4vcpu-8gb",
        region: "nyc1",
        node_type: NodeType::Worker,
        labels: vec![],
    }, ctx).await?;

    println!("Scaling job: {:?}", job);

    // Monitor progress
    let pool = platform.pool().await?;
    let mut stream = pool.subscribe_node_status("pool-123").await?;

    while let Some(event) = stream.next().await {
        println!("Node status update: {:?}", event);
    }

    Ok(())
}
```

### 10.2 Python Client (via hanzo-zap)

```python
from hanzo_zap import Client, ScaleUpRequest

async def main():
    # Connect to ZAP gateway
    client = await Client.connect("zap://zapd:9999")

    # Get Platform capability
    platform = await client.platform()

    # Scale up
    scaling = await platform.scaling()
    job = await scaling.scale_up(ScaleUpRequest(
        pool_id="pool-123",
        provider_id="do-prod",
        count=3,
        size="s-4vcpu-8gb",
        region="nyc1",
    ))

    print(f"Scaling job: {job}")

    # Subscribe to updates
    pool = await platform.pool()
    async for event in pool.subscribe_node_status("pool-123"):
        print(f"Update: {event}")
```

---

## 11. Testing Strategy

### 11.1 Unit Tests

```rust
#[tokio::test]
async fn test_scale_up_request_serialization() {
    let req = ScaleUpRequest {
        pool_id: "test-pool".to_string(),
        provider_id: "test-provider".to_string(),
        count: 3,
        size: "s-2vcpu-4gb".to_string(),
        region: "nyc1".to_string(),
        node_type: NodeType::Worker,
        labels: vec![],
    };

    let bytes = req.to_capnp_bytes();
    let decoded = ScaleUpRequest::from_capnp_bytes(&bytes)?;

    assert_eq!(req, decoded);
}
```

### 11.2 Integration Tests

```rust
#[tokio::test]
async fn test_trpc_bridge_scale_up() {
    // Start mock tRPC server
    let mock = MockTrpcServer::start().await;
    mock.expect_call("digitalocean.scaleUp")
        .returning(|_| ScalingJob { /* ... */ });

    // Create bridge
    let bridge = TrpcBridge::new(&mock.url(), "test-token");

    // Execute
    let result = bridge.call::<_, ScalingJob>("digitalocean.scaleUp", &input).await?;

    assert!(result.job_id.is_some());
}
```

### 11.3 Performance Benchmarks

```rust
#[bench]
fn bench_scale_up_zap_vs_mcp(b: &mut Bencher) {
    let runtime = tokio::runtime::Runtime::new().unwrap();

    b.iter(|| {
        runtime.block_on(async {
            // ZAP call
            let zap_start = Instant::now();
            zap_client.scaling().scale_up(&req).await.unwrap();
            let zap_duration = zap_start.elapsed();

            // MCP call
            let mcp_start = Instant::now();
            mcp_client.call_tool("scale-up", &args).await.unwrap();
            let mcp_duration = mcp_start.elapsed();

            assert!(zap_duration < mcp_duration / 100);
        });
    });
}
```

---

## 12. Monitoring and Observability

### 12.1 Metrics

```rust
// Prometheus metrics for ZAP server
lazy_static! {
    static ref ZAP_REQUESTS: Counter = Counter::new(
        "platform_zap_requests_total",
        "Total ZAP requests"
    );
    static ref ZAP_LATENCY: Histogram = Histogram::new(
        "platform_zap_request_duration_seconds",
        "ZAP request latency"
    );
    static ref ZAP_ACTIVE_CONNECTIONS: Gauge = Gauge::new(
        "platform_zap_active_connections",
        "Active ZAP connections"
    );
}
```

### 12.2 Tracing

```rust
#[tracing::instrument(skip(ctx))]
async fn scale_up(&self, req: ScaleUpRequest, ctx: CallContext) -> Result<ScalingJob> {
    let span = tracing::info_span!("scale_up",
        pool_id = %req.pool_id,
        count = req.count,
    );

    async move {
        // Operation
    }.instrument(span).await
}
```

---

## 13. Summary

This design provides:

1. **Native ZAP endpoint** for Platform with ~500x performance improvement
2. **Seamless tRPC bridge** to leverage existing implementation
3. **zapd gateway integration** for unified tool discovery
4. **MCP backwards compatibility** during transition
5. **Consensus-backed routing** for critical operations
6. **Post-quantum security** for future-proofing
7. **Comprehensive testing** and monitoring

The phased implementation approach allows for incremental adoption while maintaining full backwards compatibility with existing MCP clients.

---

**Document Version:** 1.0.0
**Last Updated:** January 2026
**Authors:** Hanzo AI Engineering
**License:** MIT
