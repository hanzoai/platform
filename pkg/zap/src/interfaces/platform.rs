//! Platform interface implementation
//!
//! Top-level capability that provides access to all other interfaces.

use crate::auth::{AuthContext, JwtAuth};
use crate::error::{Error, Result};
use crate::platform_capnp::platform;
use crate::trpc_bridge::TrpcBridge;
use capnp::capability::Promise;
use std::sync::Arc;

use super::{CloudImpl, DeployImpl, InfraImpl, PoolImpl, ScalingImpl};

/// Platform interface implementation
pub struct PlatformImpl {
    trpc_bridge: Arc<TrpcBridge>,
    auth: Arc<JwtAuth>,
    auth_context: Option<AuthContext>,
}

impl PlatformImpl {
    /// Create a new Platform implementation
    pub fn new(trpc_bridge: Arc<TrpcBridge>, auth: Arc<JwtAuth>) -> Self {
        Self {
            trpc_bridge,
            auth,
            auth_context: None,
        }
    }

    /// Create with pre-authenticated context
    pub fn with_auth(
        trpc_bridge: Arc<TrpcBridge>,
        auth: Arc<JwtAuth>,
        auth_context: AuthContext,
    ) -> Self {
        Self {
            trpc_bridge,
            auth,
            auth_context: Some(auth_context),
        }
    }

    /// Get auth context or return error
    fn require_auth(&self) -> Result<&AuthContext> {
        self.auth_context
            .as_ref()
            .ok_or_else(|| Error::Auth("Not authenticated".to_string()))
    }
}

impl platform::Server for PlatformImpl {
    /// Initialize connection with authentication
    fn initialize(
        &mut self,
        _params: platform::InitializeParams,
        _results: platform::InitializeResults,
    ) -> Promise<(), capnp::Error> {
        // Stub: authentication not yet implemented
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Get Cloud interface
    fn cloud(
        &mut self,
        _params: platform::CloudParams,
        mut results: platform::CloudResults,
    ) -> Promise<(), capnp::Error> {
        let auth = match self.require_auth() {
            Ok(a) => a.clone(),
            Err(e) => return Promise::err(capnp::Error::failed(e.to_string())),
        };

        let cloud_impl = CloudImpl::new(self.trpc_bridge.clone(), auth);

        results.get().set_cloud(capnp_rpc::new_client(cloud_impl));
        Promise::ok(())
    }

    /// Get Scaling interface
    fn scaling(
        &mut self,
        _params: platform::ScalingParams,
        mut results: platform::ScalingResults,
    ) -> Promise<(), capnp::Error> {
        let auth = match self.require_auth() {
            Ok(a) => a.clone(),
            Err(e) => return Promise::err(capnp::Error::failed(e.to_string())),
        };

        let scaling_impl = ScalingImpl::new(self.trpc_bridge.clone(), auth);

        results.get().set_scaling(capnp_rpc::new_client(scaling_impl));
        Promise::ok(())
    }

    /// Get Pool interface
    fn pool(
        &mut self,
        _params: platform::PoolParams,
        mut results: platform::PoolResults,
    ) -> Promise<(), capnp::Error> {
        let auth = match self.require_auth() {
            Ok(a) => a.clone(),
            Err(e) => return Promise::err(capnp::Error::failed(e.to_string())),
        };

        let pool_impl = PoolImpl::new(self.trpc_bridge.clone(), auth);

        results.get().set_pool(capnp_rpc::new_client(pool_impl));
        Promise::ok(())
    }

    /// Get Infra interface
    fn infra(
        &mut self,
        _params: platform::InfraParams,
        mut results: platform::InfraResults,
    ) -> Promise<(), capnp::Error> {
        let auth = match self.require_auth() {
            Ok(a) => a.clone(),
            Err(e) => return Promise::err(capnp::Error::failed(e.to_string())),
        };

        let infra_impl = InfraImpl::new(self.trpc_bridge.clone(), auth);

        results.get().set_infra(capnp_rpc::new_client(infra_impl));
        Promise::ok(())
    }

    /// Get Deploy interface
    fn deploy(
        &mut self,
        _params: platform::DeployParams,
        mut results: platform::DeployResults,
    ) -> Promise<(), capnp::Error> {
        let auth = match self.require_auth() {
            Ok(a) => a.clone(),
            Err(e) => return Promise::err(capnp::Error::failed(e.to_string())),
        };

        let deploy_impl = DeployImpl::new(self.trpc_bridge.clone(), auth);

        results.get().set_deploy(capnp_rpc::new_client(deploy_impl));
        Promise::ok(())
    }

    /// Ping for latency measurement
    fn ping(
        &mut self,
        _params: platform::PingParams,
        mut results: platform::PingResults,
    ) -> Promise<(), capnp::Error> {
        use std::time::{SystemTime, UNIX_EPOCH};

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();

        let mut ping = results.get();
        ping.set_latency_ns(0); // Client calculates actual latency
        ping.set_server_time(now.as_nanos() as u64);

        Promise::ok(())
    }

    /// Get tool catalog
    fn get_catalog(
        &mut self,
        _params: platform::GetCatalogParams,
        _results: platform::GetCatalogResults,
    ) -> Promise<(), capnp::Error> {
        // Stub: catalog not yet implemented
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }
}
