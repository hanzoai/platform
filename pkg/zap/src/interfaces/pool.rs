//! Pool interface implementation
//!
//! Manages compute pools and their nodes.

use crate::auth::AuthContext;
use crate::platform_capnp::pool;
use crate::trpc_bridge::TrpcBridge;
use capnp::capability::Promise;
use std::sync::Arc;

/// Pool interface implementation
pub struct PoolImpl {
    #[allow(dead_code)]
    trpc_bridge: Arc<TrpcBridge>,
    #[allow(dead_code)]
    auth: AuthContext,
}

impl PoolImpl {
    pub fn new(trpc_bridge: Arc<TrpcBridge>, auth: AuthContext) -> Self {
        Self { trpc_bridge, auth }
    }
}

impl pool::Server for PoolImpl {
    /// Create a new compute pool
    fn create_pool(
        &mut self,
        _params: pool::CreatePoolParams,
        _results: pool::CreatePoolResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("pool.createPool not yet implemented".to_string()))
    }

    /// Get pool details
    fn get_pool(
        &mut self,
        _params: pool::GetPoolParams,
        _results: pool::GetPoolResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("pool.getPool not yet implemented".to_string()))
    }

    /// List all pools
    fn list_pools(
        &mut self,
        _params: pool::ListPoolsParams,
        _results: pool::ListPoolsResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("pool.listPools not yet implemented".to_string()))
    }

    /// Update pool configuration
    fn update_pool(
        &mut self,
        _params: pool::UpdatePoolParams,
        _results: pool::UpdatePoolResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("pool.updatePool not yet implemented".to_string()))
    }

    /// Delete a pool
    fn delete_pool(
        &mut self,
        _params: pool::DeletePoolParams,
        _results: pool::DeletePoolResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("pool.deletePool not yet implemented".to_string()))
    }

    /// List nodes in a pool
    fn list_nodes(
        &mut self,
        _params: pool::ListNodesParams,
        _results: pool::ListNodesResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("pool.listNodes not yet implemented".to_string()))
    }

    /// Get a specific node
    fn get_node(
        &mut self,
        _params: pool::GetNodeParams,
        _results: pool::GetNodeResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("pool.getNode not yet implemented".to_string()))
    }

    /// Set auto-scaling configuration
    fn set_auto_scaling(
        &mut self,
        _params: pool::SetAutoScalingParams,
        _results: pool::SetAutoScalingResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("pool.setAutoScaling not yet implemented".to_string()))
    }

    /// Subscribe to node status updates
    fn subscribe_node_status(
        &mut self,
        _params: pool::SubscribeNodeStatusParams,
        _results: pool::SubscribeNodeStatusResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("pool.subscribeNodeStatus not yet implemented".to_string()))
    }
}
