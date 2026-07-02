//! tRPC Bridge for Platform ZAP Server
//!
//! Bridges ZAP calls to existing Platform tRPC endpoints via HTTP.

use crate::error::{Error, Result};
use reqwest::{Client, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::time::Duration;
use tracing::{debug, error, instrument, warn};

/// tRPC request wrapper
#[derive(Debug, Serialize)]
struct TrpcInput<T: Serialize> {
    #[serde(skip_serializing_if = "Option::is_none")]
    input: Option<T>,
}

/// tRPC response wrapper
#[derive(Debug, Deserialize)]
struct TrpcResponse<T> {
    result: Option<TrpcResult<T>>,
    error: Option<TrpcError>,
}

/// tRPC result
#[derive(Debug, Deserialize)]
struct TrpcResult<T> {
    data: T,
}

/// tRPC error
#[derive(Debug, Deserialize)]
struct TrpcError {
    message: String,
    code: Option<String>,
    data: Option<serde_json::Value>,
}

/// tRPC bridge to Platform API
#[derive(Debug, Clone)]
pub struct TrpcBridge {
    client: Client,
    base_url: String,
    timeout_ms: u64,
    max_retries: u32,
    retry_delay_ms: u64,
}

impl TrpcBridge {
    /// Create a new tRPC bridge
    pub fn new(base_url: &str, timeout_ms: u64) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_millis(timeout_ms))
            .pool_max_idle_per_host(10)
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            timeout_ms,
            max_retries: 3,
            retry_delay_ms: 1000,
        }
    }

    /// Create with retry configuration
    pub fn with_retries(mut self, max_retries: u32, retry_delay_ms: u64) -> Self {
        self.max_retries = max_retries;
        self.retry_delay_ms = retry_delay_ms;
        self
    }

    /// Call a tRPC query (GET)
    #[instrument(skip(self, input))]
    pub async fn query<I, O>(&self, procedure: &str, input: &I, auth_token: &str) -> Result<O>
    where
        I: Serialize + std::fmt::Debug,
        O: DeserializeOwned,
    {
        let url = format!("{}/v1/trpc/{}", self.base_url, procedure);
        let input_json = serde_json::to_string(&TrpcInput { input: Some(input) })?;

        debug!(procedure, %url, "Calling tRPC query");

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", auth_token))
            .query(&[("input", input_json)])
            .send()
            .await?;

        self.handle_response(response, procedure).await
    }

    /// Call a tRPC mutation (POST)
    #[instrument(skip(self, input))]
    pub async fn mutation<I, O>(&self, procedure: &str, input: &I, auth_token: &str) -> Result<O>
    where
        I: Serialize + std::fmt::Debug,
        O: DeserializeOwned,
    {
        let url = format!("{}/v1/trpc/{}", self.base_url, procedure);

        debug!(procedure, %url, "Calling tRPC mutation");

        let mut retries = 0;
        let mut last_error: Option<Error> = None;

        while retries <= self.max_retries {
            let response = self
                .client
                .post(&url)
                .header("Authorization", format!("Bearer {}", auth_token))
                .header("Content-Type", "application/json")
                .json(&TrpcInput { input: Some(input) })
                .send()
                .await;

            match response {
                Ok(resp) => {
                    return self.handle_response(resp, procedure).await;
                }
                Err(e) => {
                    last_error = Some(Error::Http(e));
                    if retries < self.max_retries {
                        warn!(
                            procedure,
                            retry = retries + 1,
                            max_retries = self.max_retries,
                            "Retrying tRPC call"
                        );
                        tokio::time::sleep(Duration::from_millis(
                            self.retry_delay_ms * (2_u64.pow(retries)),
                        ))
                        .await;
                    }
                    retries += 1;
                }
            }
        }

        Err(last_error.unwrap_or_else(|| Error::TrpcBridge("Max retries exceeded".to_string())))
    }

    /// Handle tRPC response
    async fn handle_response<O: DeserializeOwned>(
        &self,
        response: reqwest::Response,
        procedure: &str,
    ) -> Result<O> {
        let status = response.status();

        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            error!(procedure, %status, %error_text, "tRPC call failed");

            return match status {
                StatusCode::UNAUTHORIZED => Err(Error::Unauthorized("Invalid token".to_string())),
                StatusCode::FORBIDDEN => Err(Error::Unauthorized("Access denied".to_string())),
                StatusCode::NOT_FOUND => Err(Error::NotFound(procedure.to_string())),
                StatusCode::BAD_REQUEST => Err(Error::InvalidRequest(error_text)),
                _ => Err(Error::TrpcBridge(format!(
                    "HTTP {}: {}",
                    status, error_text
                ))),
            };
        }

        let body: TrpcResponse<O> = response.json().await?;

        if let Some(error) = body.error {
            error!(
                procedure,
                code = ?error.code,
                message = %error.message,
                "tRPC error response"
            );
            return Err(Error::TrpcBridge(error.message));
        }

        body.result
            .map(|r| r.data)
            .ok_or_else(|| Error::TrpcBridge("Empty response".to_string()))
    }
}

/// Convenience macros for common tRPC calls
#[macro_export]
macro_rules! trpc_query {
    ($bridge:expr, $procedure:expr, $input:expr, $token:expr) => {
        $bridge.query($procedure, $input, $token).await
    };
}

#[macro_export]
macro_rules! trpc_mutation {
    ($bridge:expr, $procedure:expr, $input:expr, $token:expr) => {
        $bridge.mutation($procedure, $input, $token).await
    };
}

/// Type-safe procedure names for Platform tRPC API
pub mod procedures {
    // DigitalOcean procedures
    pub const DO_CONFIGURE_PROVIDER: &str = "digitalocean.configureProvider";
    pub const DO_UPDATE_PROVIDER: &str = "digitalocean.updateProvider";
    pub const DO_LIST_PROVIDERS: &str = "digitalocean.listProviders";
    pub const DO_GET_PROVIDER: &str = "digitalocean.getProvider";
    pub const DO_DELETE_PROVIDER: &str = "digitalocean.deleteProvider";
    pub const DO_LIST_SIZES: &str = "digitalocean.listSizes";
    pub const DO_LIST_REGIONS: &str = "digitalocean.listRegions";
    pub const DO_SCALE_UP: &str = "digitalocean.scaleUp";
    pub const DO_SCALE_DOWN: &str = "digitalocean.scaleDown";
    pub const DO_RESIZE_DROPLET: &str = "digitalocean.resizeDroplet";
    pub const DO_DRAIN_NODE: &str = "digitalocean.drainNode";
    pub const DO_REMOVE_DROPLET: &str = "digitalocean.removeDroplet";
    pub const DO_LIST_POOL_DROPLETS: &str = "digitalocean.listPoolDroplets";
    pub const DO_GET_SCALING_STATUS: &str = "digitalocean.getScalingStatus";
    pub const DO_LIST_SCALING_JOBS: &str = "digitalocean.listScalingJobs";
    pub const DO_CREATE_FIREWALL: &str = "digitalocean.createFirewall";
    pub const DO_CREATE_LOAD_BALANCER: &str = "digitalocean.createLoadBalancer";
    pub const DO_REGISTER_NODE: &str = "digitalocean.registerNode";

    // Server procedures
    pub const SERVER_CREATE: &str = "server.create";
    pub const SERVER_ONE: &str = "server.one";
    pub const SERVER_ALL: &str = "server.all";
    pub const SERVER_UPDATE: &str = "server.update";
    pub const SERVER_REMOVE: &str = "server.remove";
    pub const SERVER_SETUP: &str = "server.setup";
    pub const SERVER_VALIDATE: &str = "server.validate";

    // Application procedures
    pub const APP_CREATE: &str = "application.create";
    pub const APP_ONE: &str = "application.one";
    pub const APP_UPDATE: &str = "application.update";
    pub const APP_DELETE: &str = "application.delete";
    pub const APP_DEPLOY: &str = "application.deploy";
    pub const APP_REDEPLOY: &str = "application.redeploy";
    pub const APP_START: &str = "application.start";
    pub const APP_STOP: &str = "application.stop";
    pub const APP_RELOAD: &str = "application.reload";

    // Project procedures
    pub const PROJECT_ALL: &str = "project.all";
    pub const PROJECT_ONE: &str = "project.one";
    pub const PROJECT_CREATE: &str = "project.create";
    pub const PROJECT_UPDATE: &str = "project.update";
    pub const PROJECT_REMOVE: &str = "project.remove";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bridge_creation() {
        let bridge = TrpcBridge::new("http://localhost:3000", 30000);
        assert_eq!(bridge.base_url, "http://localhost:3000");
        assert_eq!(bridge.timeout_ms, 30000);
    }

    #[test]
    fn test_bridge_url_normalization() {
        let bridge = TrpcBridge::new("http://localhost:3000/", 30000);
        assert_eq!(bridge.base_url, "http://localhost:3000");
    }
}
