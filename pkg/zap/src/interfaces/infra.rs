//! Infrastructure interface implementation
//!
//! Manages infrastructure components like firewalls and load balancers.

use crate::auth::AuthContext;
use crate::platform_capnp::infra;
use crate::trpc_bridge::TrpcBridge;
use capnp::capability::Promise;
use std::sync::Arc;

/// Infra interface implementation
pub struct InfraImpl {
    #[allow(dead_code)]
    trpc_bridge: Arc<TrpcBridge>,
    #[allow(dead_code)]
    auth: AuthContext,
}

impl InfraImpl {
    pub fn new(trpc_bridge: Arc<TrpcBridge>, auth: AuthContext) -> Self {
        Self { trpc_bridge, auth }
    }
}

impl infra::Server for InfraImpl {
    /// Create firewall rules
    fn create_firewall(
        &mut self,
        _params: infra::CreateFirewallParams,
        _results: infra::CreateFirewallResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Get firewall details
    fn get_firewall(
        &mut self,
        _params: infra::GetFirewallParams,
        _results: infra::GetFirewallResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Update firewall rules
    fn update_firewall(
        &mut self,
        _params: infra::UpdateFirewallParams,
        _results: infra::UpdateFirewallResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Delete a firewall
    fn delete_firewall(
        &mut self,
        _params: infra::DeleteFirewallParams,
        _results: infra::DeleteFirewallResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Create a load balancer
    fn create_load_balancer(
        &mut self,
        _params: infra::CreateLoadBalancerParams,
        _results: infra::CreateLoadBalancerResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Get load balancer details
    fn get_load_balancer(
        &mut self,
        _params: infra::GetLoadBalancerParams,
        _results: infra::GetLoadBalancerResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Update load balancer configuration
    fn update_load_balancer(
        &mut self,
        _params: infra::UpdateLoadBalancerParams,
        _results: infra::UpdateLoadBalancerResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Delete a load balancer
    fn delete_load_balancer(
        &mut self,
        _params: infra::DeleteLoadBalancerParams,
        _results: infra::DeleteLoadBalancerResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }
}
