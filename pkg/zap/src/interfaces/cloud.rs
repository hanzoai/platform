//! Cloud interface implementation
//!
//! Manages cloud provider configuration and discovery.

use crate::auth::AuthContext;
use crate::platform_capnp::cloud;
use crate::trpc_bridge::TrpcBridge;
use capnp::capability::Promise;
use std::sync::Arc;

/// Cloud interface implementation
pub struct CloudImpl {
    #[allow(dead_code)]
    trpc_bridge: Arc<TrpcBridge>,
    #[allow(dead_code)]
    auth: AuthContext,
}

impl CloudImpl {
    pub fn new(trpc_bridge: Arc<TrpcBridge>, auth: AuthContext) -> Self {
        Self { trpc_bridge, auth }
    }
}

impl cloud::Server for CloudImpl {
    /// Configure a new cloud provider
    fn configure_provider(
        &mut self,
        _params: cloud::ConfigureProviderParams,
        _results: cloud::ConfigureProviderResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Update an existing cloud provider
    fn update_provider(
        &mut self,
        _params: cloud::UpdateProviderParams,
        _results: cloud::UpdateProviderResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Get provider details
    fn get_provider(
        &mut self,
        _params: cloud::GetProviderParams,
        _results: cloud::GetProviderResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// List all providers
    fn list_providers(
        &mut self,
        _params: cloud::ListProvidersParams,
        _results: cloud::ListProvidersResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Delete a provider
    fn delete_provider(
        &mut self,
        _params: cloud::DeleteProviderParams,
        _results: cloud::DeleteProviderResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// List available regions
    fn list_regions(
        &mut self,
        _params: cloud::ListRegionsParams,
        _results: cloud::ListRegionsResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// List available sizes
    fn list_sizes(
        &mut self,
        _params: cloud::ListSizesParams,
        _results: cloud::ListSizesResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }
}
