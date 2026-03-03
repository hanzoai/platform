//! ZAP interface implementations
//!
//! Each interface wraps Platform's tRPC endpoints and exposes them
//! via Cap'n Proto RPC.

mod platform;
mod cloud;
mod scaling;
mod pool;
mod infra;
mod deploy;

pub use platform::PlatformImpl;
pub use cloud::CloudImpl;
pub use scaling::ScalingImpl;
pub use pool::PoolImpl;
pub use infra::InfraImpl;
pub use deploy::DeployImpl;
