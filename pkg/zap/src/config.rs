//! Configuration for platform-zap

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use crate::error::{Error, Result};

/// Server configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Server settings
    #[serde(default)]
    pub server: ServerConfig,

    /// TLS settings
    #[serde(default)]
    pub tls: TlsConfig,

    /// tRPC bridge settings
    #[serde(default)]
    pub trpc: TrpcConfig,

    /// Authentication settings
    #[serde(default)]
    pub auth: AuthConfig,

    /// Consensus settings
    #[serde(default)]
    pub consensus: ConsensusConfig,

    /// Metrics settings
    #[serde(default)]
    pub metrics: MetricsConfig,
}

/// Server configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    /// Listen address
    #[serde(default = "default_listen")]
    pub listen: String,

    /// Port number
    #[serde(default = "default_port")]
    pub port: u16,

    /// Log level
    #[serde(default = "default_log_level")]
    pub log_level: String,

    /// Worker threads (0 = auto)
    #[serde(default)]
    pub worker_threads: usize,
}

/// TLS configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsConfig {
    /// Enable TLS
    #[serde(default)]
    pub enabled: bool,

    /// Certificate file path
    pub cert: Option<String>,

    /// Private key file path
    pub key: Option<String>,

    /// CA certificate for client verification
    pub ca: Option<String>,

    /// Require client certificates
    #[serde(default)]
    pub require_client_cert: bool,
}

/// tRPC bridge configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrpcConfig {
    /// Base URL for Platform tRPC API
    #[serde(default = "default_trpc_url")]
    pub base_url: String,

    /// Request timeout in milliseconds
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,

    /// Maximum retries
    #[serde(default = "default_retries")]
    pub max_retries: u32,

    /// Retry delay in milliseconds
    #[serde(default = "default_retry_delay")]
    pub retry_delay_ms: u64,
}

/// Authentication configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthConfig {
    /// Auth type: "bearer", "basic", or "none"
    #[serde(default = "default_auth_type")]
    pub auth_type: String,

    /// Secret for JWT signing
    pub secret: Option<String>,

    /// Token expiration in seconds
    #[serde(default = "default_token_expiry")]
    pub token_expiry_secs: u64,
}

/// Consensus configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsensusConfig {
    /// Enable consensus for critical operations
    #[serde(default)]
    pub enabled: bool,

    /// Lux consensus endpoint
    pub endpoint: Option<String>,

    /// Minimum confidence threshold
    #[serde(default = "default_min_confidence")]
    pub min_confidence: f64,

    /// Consensus timeout in milliseconds
    #[serde(default = "default_consensus_timeout")]
    pub timeout_ms: u64,
}

/// Metrics configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricsConfig {
    /// Enable metrics
    #[serde(default)]
    pub enabled: bool,

    /// Metrics port
    #[serde(default = "default_metrics_port")]
    pub port: u16,

    /// Metrics path
    #[serde(default = "default_metrics_path")]
    pub path: String,
}

// Default values
fn default_listen() -> String {
    "0.0.0.0".to_string()
}

fn default_port() -> u16 {
    9998
}

fn default_log_level() -> String {
    "info".to_string()
}

fn default_trpc_url() -> String {
    "http://localhost:3000".to_string()
}

fn default_timeout() -> u64 {
    60000
}

fn default_retries() -> u32 {
    3
}

fn default_retry_delay() -> u64 {
    1000
}

fn default_auth_type() -> String {
    "none".to_string()
}

fn default_token_expiry() -> u64 {
    3600
}

fn default_min_confidence() -> f64 {
    0.95
}

fn default_consensus_timeout() -> u64 {
    30000
}

fn default_metrics_port() -> u16 {
    9090
}

fn default_metrics_path() -> String {
    "/metrics".to_string()
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server: ServerConfig::default(),
            tls: TlsConfig::default(),
            trpc: TrpcConfig::default(),
            auth: AuthConfig::default(),
            consensus: ConsensusConfig::default(),
            metrics: MetricsConfig::default(),
        }
    }
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            listen: default_listen(),
            port: default_port(),
            log_level: default_log_level(),
            worker_threads: 0,
        }
    }
}

impl Default for TlsConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            cert: None,
            key: None,
            ca: None,
            require_client_cert: false,
        }
    }
}

impl Default for TrpcConfig {
    fn default() -> Self {
        Self {
            base_url: default_trpc_url(),
            timeout_ms: default_timeout(),
            max_retries: default_retries(),
            retry_delay_ms: default_retry_delay(),
        }
    }
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            auth_type: default_auth_type(),
            secret: None,
            token_expiry_secs: default_token_expiry(),
        }
    }
}

impl Default for ConsensusConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            endpoint: None,
            min_confidence: default_min_confidence(),
            timeout_ms: default_consensus_timeout(),
        }
    }
}

impl Default for MetricsConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: default_metrics_port(),
            path: default_metrics_path(),
        }
    }
}

impl Config {
    /// Load configuration from file
    pub fn load(path: &PathBuf) -> Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let config: Config =
            toml::from_str(&content).map_err(|e| Error::Config(e.to_string()))?;
        Ok(config)
    }

    /// Load configuration from environment variables
    pub fn from_env() -> Result<Self> {
        let mut config = Config::default();

        // Server config
        if let Ok(listen) = std::env::var("PLATFORM_ZAP_LISTEN") {
            config.server.listen = listen;
        }
        if let Ok(port) = std::env::var("PLATFORM_ZAP_PORT") {
            config.server.port = port.parse().map_err(|e| Error::Config(format!("Invalid port: {}", e)))?;
        }
        if let Ok(level) = std::env::var("PLATFORM_ZAP_LOG_LEVEL") {
            config.server.log_level = level;
        }

        // TLS config
        if let Ok(enabled) = std::env::var("PLATFORM_ZAP_TLS_ENABLED") {
            config.tls.enabled = enabled.parse().unwrap_or(false);
        }
        if let Ok(cert) = std::env::var("PLATFORM_ZAP_TLS_CERT") {
            config.tls.cert = Some(cert);
        }
        if let Ok(key) = std::env::var("PLATFORM_ZAP_TLS_KEY") {
            config.tls.key = Some(key);
        }

        // tRPC config
        if let Ok(url) = std::env::var("PLATFORM_TRPC_URL") {
            config.trpc.base_url = url;
        }
        if let Ok(timeout) = std::env::var("PLATFORM_TRPC_TIMEOUT_MS") {
            config.trpc.timeout_ms = timeout.parse().unwrap_or(default_timeout());
        }

        // Auth config
        if let Ok(secret) = std::env::var("PLATFORM_ZAP_SECRET") {
            config.auth.secret = Some(secret);
        }

        // Consensus config
        if let Ok(enabled) = std::env::var("PLATFORM_ZAP_CONSENSUS_ENABLED") {
            config.consensus.enabled = enabled.parse().unwrap_or(false);
        }
        if let Ok(endpoint) = std::env::var("PLATFORM_ZAP_CONSENSUS_ENDPOINT") {
            config.consensus.endpoint = Some(endpoint);
        }

        // Metrics config
        if let Ok(enabled) = std::env::var("PLATFORM_ZAP_METRICS_ENABLED") {
            config.metrics.enabled = enabled.parse().unwrap_or(false);
        }

        Ok(config)
    }

    /// Get default config path
    pub fn default_path() -> PathBuf {
        directories::ProjectDirs::from("ai", "hanzo", "platform-zap")
            .map(|dirs| dirs.config_dir().join("config.toml"))
            .unwrap_or_else(|| PathBuf::from("config.toml"))
    }

    /// Validate configuration
    pub fn validate(&self) -> Result<()> {
        // Validate TLS config
        if self.tls.enabled {
            if self.tls.cert.is_none() || self.tls.key.is_none() {
                return Err(Error::Config("TLS enabled but cert/key not provided".to_string()));
            }
        }

        // Validate auth config
        if self.auth.auth_type == "bearer" && self.auth.secret.is_none() {
            return Err(Error::Config("Bearer auth enabled but secret not provided".to_string()));
        }

        // Validate consensus config
        if self.consensus.enabled && self.consensus.endpoint.is_none() {
            return Err(Error::Config("Consensus enabled but endpoint not provided".to_string()));
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = Config::default();
        assert_eq!(config.server.port, 9998);
        assert_eq!(config.server.listen, "0.0.0.0");
        assert!(!config.tls.enabled);
    }

    #[test]
    fn test_config_validation() {
        let mut config = Config::default();

        // Should pass with defaults
        assert!(config.validate().is_ok());

        // Should fail with TLS enabled but no cert
        config.tls.enabled = true;
        assert!(config.validate().is_err());

        // Should pass with cert and key
        config.tls.cert = Some("/path/to/cert".to_string());
        config.tls.key = Some("/path/to/key".to_string());
        assert!(config.validate().is_ok());
    }
}
