//! Deploy interface implementation
//!
//! Manages application deployments.

use crate::auth::AuthContext;
use crate::platform_capnp::deploy;
use crate::trpc_bridge::TrpcBridge;
use capnp::capability::Promise;
use std::sync::Arc;

/// Deploy interface implementation
pub struct DeployImpl {
    #[allow(dead_code)]
    trpc_bridge: Arc<TrpcBridge>,
    #[allow(dead_code)]
    auth: AuthContext,
}

impl DeployImpl {
    pub fn new(trpc_bridge: Arc<TrpcBridge>, auth: AuthContext) -> Self {
        Self { trpc_bridge, auth }
    }
}

impl deploy::Server for DeployImpl {
    /// Deploy an application
    fn deploy(
        &mut self,
        _params: deploy::DeployParams,
        _results: deploy::DeployResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Redeploy an application
    fn redeploy(
        &mut self,
        _params: deploy::RedeployParams,
        _results: deploy::RedeployResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Start a stopped application
    fn start(
        &mut self,
        _params: deploy::StartParams,
        _results: deploy::StartResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Stop an application
    fn stop(
        &mut self,
        _params: deploy::StopParams,
        _results: deploy::StopResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Restart an application
    fn restart(
        &mut self,
        _params: deploy::RestartParams,
        _results: deploy::RestartResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Get application details
    fn get_application(
        &mut self,
        _params: deploy::GetApplicationParams,
        _results: deploy::GetApplicationResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// List applications in a project
    fn list_applications(
        &mut self,
        _params: deploy::ListApplicationsParams,
        _results: deploy::ListApplicationsResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// List all projects
    fn list_projects(
        &mut self,
        _params: deploy::ListProjectsParams,
        _results: deploy::ListProjectsResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Get application logs
    fn get_logs(
        &mut self,
        _params: deploy::GetLogsParams,
        _results: deploy::GetLogsResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }

    /// Stream application logs
    fn stream_logs(
        &mut self,
        _params: deploy::StreamLogsParams,
        _results: deploy::StreamLogsResults,
    ) -> Promise<(), capnp::Error> {
        Promise::err(capnp::Error::failed("Not yet implemented".to_string()))
    }
}
