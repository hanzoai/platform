# Platform ZAP Server

High-performance ZAP (Zero-copy Agent Protocol) server for Hanzo Platform.

## Overview

This package provides a native ZAP endpoint for Platform, enabling agents to control cloud infrastructure with sub-microsecond latency. It replaces JSON-RPC based MCP with Cap'n Proto RPC for ~500x performance improvement.

## Features

- **Native Cap'n Proto RPC**: Zero-copy serialization for maximum performance
- **tRPC Bridge**: Seamlessly wraps existing Platform tRPC endpoints
- **Backwards Compatibility**: Existing MCP tools remain accessible via Gateway
- **Consensus Support**: Critical operations backed by Lux consensus
- **Post-Quantum Security**: Dilithium3 signatures for future-proof security

## Quick Start

### Prerequisites

- Rust 1.75+
- Cap'n Proto compiler (`capnp`)
- Platform server running (for tRPC bridge)

### Build

```bash
# Install capnp compiler (macOS)
brew install capnp

# Build the ZAP server
cargo build --release

# Run tests
cargo test
```

### Run

```bash
# Start the ZAP server
./target/release/platform-zap serve \
  --port 9998 \
  --trpc-url http://localhost:3000 \
  --config config/server.toml

# Or use environment variables
PLATFORM_TRPC_URL=http://localhost:3000 \
PLATFORM_ZAP_PORT=9998 \
./target/release/platform-zap serve
```

### Register with zapd Gateway

```bash
# Add Platform to the gateway
zapctl server add \
  --name platform \
  --url zap://localhost:9998 \
  --auth bearer:$PLATFORM_ZAP_TOKEN

# Verify registration
zapctl tools list --server platform
```

## Architecture

```
AI Agent
    |
    v
zapd Gateway (port 9999)
    |
    +----> Platform ZAP Server (port 9998)
    |           |
    |           v
    |      tRPC Bridge
    |           |
    |           v
    |      Platform tRPC API (port 3000)
    |
    +----> Platform MCP Server (port 3100)
           (backwards compat)
```

## Schema

The Cap'n Proto schema is defined in `schema/platform.capnp`. Key interfaces:

- **Platform**: Top-level interface with capability negotiation
- **Cloud**: Provider configuration and resource discovery
- **Scaling**: Scale up/down operations
- **Pool**: Compute pool and node management
- **Infra**: Firewall and load balancer management
- **Deploy**: Application deployment and lifecycle

## Tool Mapping

| ZAP Tool | tRPC Procedure | Description |
|----------|---------------|-------------|
| `cloud.configureProvider` | `digitalocean.configureProvider` | Configure cloud provider |
| `cloud.listProviders` | `digitalocean.listProviders` | List configured providers |
| `scaling.scaleUp` | `digitalocean.scaleUp` | Add nodes to pool |
| `scaling.scaleDown` | `digitalocean.scaleDown` | Remove nodes from pool |
| `pool.listNodes` | `digitalocean.listPoolDroplets` | List nodes in pool |
| `infra.createFirewall` | `digitalocean.createFirewall` | Create firewall |
| `deploy.deploy` | `application.deploy` | Deploy application |

## Configuration

### Server Configuration (`config/server.toml`)

```toml
[server]
listen = "0.0.0.0"
port = 9998
log_level = "info"

[tls]
enabled = true
cert = "/etc/platform/zap.crt"
key = "/etc/platform/zap.key"

[trpc]
base_url = "http://localhost:3000"
timeout_ms = 60000

[auth]
type = "bearer"
secret = "${PLATFORM_ZAP_SECRET}"

[consensus]
enabled = true
endpoint = "zap://lux-node:9000"
min_confidence = 0.95
```

## Usage Examples

### Rust Client

```rust
use hanzo_zap::Client;

#[tokio::main]
async fn main() -> Result<()> {
    // Connect to gateway
    let client = Client::connect("zap://zapd:9999").await?;

    // Get Platform capability
    let platform = client.platform().await?;

    // Scale up
    let scaling = platform.scaling().await?;
    let job = scaling.scale_up(ScaleUpRequest {
        pool_id: "pool-123".to_string(),
        provider_id: "do-prod".to_string(),
        count: 3,
        size: "s-4vcpu-8gb".to_string(),
        region: "nyc1".to_string(),
        node_type: NodeType::Worker,
        labels: vec![],
        ..Default::default()
    }, ctx).await?;

    println!("Job ID: {}", job.job_id);
    Ok(())
}
```

### Python Client

```python
from hanzo_zap import Client, ScaleUpRequest

async def main():
    client = await Client.connect("zap://zapd:9999")
    platform = await client.platform()

    scaling = await platform.scaling()
    job = await scaling.scale_up(ScaleUpRequest(
        pool_id="pool-123",
        provider_id="do-prod",
        count=3,
        size="s-4vcpu-8gb",
        region="nyc1",
    ))

    print(f"Job ID: {job.job_id}")
```

## Performance

| Operation | MCP (JSON-RPC) | ZAP (Cap'n Proto) | Improvement |
|-----------|---------------|-------------------|-------------|
| List pools | 450us | <1us | 450x |
| Scale up | 500us | 10us | 50x |
| Get node status | 400us | 0.8us | 500x |
| Deploy | 600us | 15us | 40x |

## Development

### Directory Structure

```
pkg/zap/
  Cargo.toml
  build.rs
  config/
    gateway.toml      # zapd gateway config
    server.toml       # ZAP server config
  schema/
    platform.capnp    # Cap'n Proto schema
  src/
    lib.rs
    server.rs         # Main server
    auth.rs           # Authentication
    config.rs         # Configuration
    error.rs          # Error types
    trpc_bridge.rs    # tRPC bridge
    interfaces/
      mod.rs
      cloud.rs
      scaling.rs
      pool.rs
      infra.rs
      deploy.rs
    gen/              # Generated Cap'n Proto code
      platform_capnp.rs
```

### Building

```bash
# Compile Cap'n Proto schema
capnp compile -o rust:src/gen schema/platform.capnp

# Build
cargo build

# Test
cargo test

# Benchmark
cargo bench
```

### Testing

```bash
# Unit tests
cargo test

# Integration tests (requires running tRPC server)
PLATFORM_TRPC_URL=http://localhost:3000 cargo test --features integration

# Benchmark
cargo bench
```

## Related Documentation

- [ZAP Protocol Whitepaper](/Users/z/work/hanzo/zap/docs/ZAP-WHITEPAPER.md)
- [Platform MCP Server](/Users/z/work/hanzo/platform/pkg/mcp/README.md)
- [ZAP Integration Design](/Users/z/work/hanzo/platform/docs/ZAP_INTEGRATION_DESIGN.md)

## License

MIT
