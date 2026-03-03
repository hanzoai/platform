//! Platform ZAP Server
//!
//! High-performance ZAP (Zero-copy Agent Protocol) server for Hanzo Platform.
//! Enables agents to control cloud infrastructure with sub-microsecond latency.
//!
//! # Features
//!
//! - Native Cap'n Proto RPC for zero-copy serialization
//! - tRPC bridge to existing Platform endpoints
//! - Backwards compatibility with MCP via Gateway
//! - Consensus support via Lux network
//! - Post-quantum security with Dilithium3
//!
//! # Example
//!
//! ```rust,no_run
//! use platform_zap::{Server, Config};
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     let config = Config::from_env()?;
//!     let server = Server::new(config);
//!     server.run().await?;
//!     Ok(())
//! }
//! ```

pub mod config;
pub mod error;
pub mod server;
pub mod trpc_bridge;
pub mod auth;
pub mod interfaces;

// Re-exports
pub use config::Config;
pub use error::{Error, Result};
pub use server::Server;
pub use trpc_bridge::TrpcBridge;

/// Version of the platform-zap server
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// ZAP protocol version
pub const PROTOCOL_VERSION: &str = "2026-01-30";

// Include generated Cap'n Proto code
pub mod platform_capnp {
    include!(concat!(env!("OUT_DIR"), "/platform_capnp.rs"));
}
