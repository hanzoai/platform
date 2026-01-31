//! Scaling interface implementation
//!
//! Manages scale up/down operations for compute pools.

use crate::auth::AuthContext;
use crate::platform_capnp::scaling;
use crate::trpc_bridge::TrpcBridge;
use capnp::capability::Promise;
use std::sync::Arc;

/// Scaling interface implementation
pub struct ScalingImpl {
    #[allow(dead_code)]
    trpc_bridge: Arc<TrpcBridge>,
    #[allow(dead_code)]
    auth: AuthContext,
}

impl ScalingImpl {
    pub fn new(trpc_bridge: Arc<TrpcBridge>, auth: AuthContext) -> Self {
        Self { trpc_bridge, auth }
    }
}

impl scaling::Server for ScalingImpl {
    /// Scale up - add nodes to a pool
    fn scale_up(
        &mut self,
        _params: scaling::ScaleUpParams,
        _results: scaling::ScaleUpResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Scale down - remove nodes from a pool
    fn scale_down(
        &mut self,
        _params: scaling::ScaleDownParams,
        _results: scaling::ScaleDownResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Resize a droplet
    fn resize_droplet(
        &mut self,
        _params: scaling::ResizeDropletParams,
        _results: scaling::ResizeDropletResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Drain a node
    fn drain_node(
        &mut self,
        _params: scaling::DrainNodeParams,
        _results: scaling::DrainNodeResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Get a scaling job by ID
    fn get_scaling_job(
        &mut self,
        _params: scaling::GetScalingJobParams,
        _results: scaling::GetScalingJobResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// List scaling jobs for a pool
    fn list_scaling_jobs(
        &mut self,
        _params: scaling::ListScalingJobsParams,
        _results: scaling::ListScalingJobsResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Cancel a scaling job
    fn cancel_scaling_job(
        &mut self,
        _params: scaling::CancelScalingJobParams,
        _results: scaling::CancelScalingJobResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }
}
