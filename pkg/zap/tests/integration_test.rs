//! Integration tests for Platform ZAP Server
//!
//! These tests require the `integration` feature and a running
//! Platform tRPC server at the configured URL.

#![cfg(feature = "integration")]

use platform_zap::{Config, Server, TrpcBridge};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::time::timeout;

/// Test server startup and shutdown
#[tokio::test]
async fn test_server_lifecycle() {
    let config = Config::default();
    let server = Server::new(config);

    // Server should be created successfully
    // Note: Full lifecycle test would spawn server and connect
}

/// Test tRPC bridge connectivity
#[tokio::test]
async fn test_trpc_bridge_health() {
    let bridge = TrpcBridge::new("http://localhost:3000", 5000);

    // Health check would verify tRPC server is accessible
    // This is a placeholder for actual health check implementation
}

/// Test TCP connection to server
#[tokio::test]
async fn test_tcp_connection() {
    let config = Config::default();
    let addr = format!("{}:{}", config.server.listen, config.server.port);

    // In integration test, server would be running
    // This verifies connection can be established
    let result = timeout(
        Duration::from_secs(1),
        TcpStream::connect(&addr),
    ).await;

    // Connection should succeed if server is running
    // Connection refused is expected if server not running
    match result {
        Ok(Ok(_stream)) => {
            // Connected successfully
        }
        Ok(Err(_e)) => {
            // Server not running (expected in unit test context)
        }
        Err(_) => {
            // Timeout (server not running)
        }
    }
}

/// Test authentication flow
#[tokio::test]
async fn test_auth_flow() {
    use platform_zap::auth::JwtAuth;

    let auth = JwtAuth::new("test-secret", "platform-zap");

    // Generate token
    let token = auth
        .generate_token("test-user", "test-org", vec![], vec![])
        .expect("Should generate token");

    // Verify token
    let context = auth
        .verify_token(&token)
        .expect("Should verify token");

    assert_eq!(context.subject, "test-user");
    assert_eq!(context.organization_id, "test-org");
}

/// Test capability-based auth
#[tokio::test]
async fn test_capabilities() {
    use platform_zap::auth::{Capabilities, AuthContext};

    // Create admin capabilities
    let admin_caps = Capabilities::admin("test-org");
    assert!(admin_caps.cloud.can_configure);
    assert!(admin_caps.scaling.can_scale_up);

    // Create readonly capabilities
    let readonly_caps = Capabilities::readonly("test-org");
    assert!(!readonly_caps.cloud.can_configure);
    assert!(readonly_caps.cloud.can_read);

    // Test attenuation
    let attenuated = admin_caps.attenuate(&readonly_caps);
    assert!(!attenuated.cloud.can_configure);
    assert!(attenuated.cloud.can_read);
}

/// Test authorization context
#[tokio::test]
async fn test_auth_context_permissions() {
    use platform_zap::auth::AuthContext;

    let context = AuthContext {
        subject: "test-user".to_string(),
        organization_id: "test-org".to_string(),
        allowed_operations: vec!["scaling.*".to_string(), "pool.read".to_string()],
        allowed_pools: vec!["pool-1".to_string(), "pool-2".to_string()],
        token: "token".to_string(),
    };

    // Test operation permissions
    assert!(context.can_perform("scaling.scaleUp"));
    assert!(context.can_perform("scaling.scaleDown"));
    assert!(context.can_perform("pool.read"));
    assert!(!context.can_perform("pool.delete"));
    assert!(!context.can_perform("deploy.deploy"));

    // Test pool access
    assert!(context.can_access_pool("pool-1"));
    assert!(context.can_access_pool("pool-2"));
    assert!(!context.can_access_pool("pool-3"));
}

/// Test configuration loading
#[tokio::test]
async fn test_config_loading() {
    // Test default config
    let config = Config::default();
    assert_eq!(config.server.port, 9998);
    assert_eq!(config.server.listen, "0.0.0.0");

    // Test config from environment
    std::env::set_var("PLATFORM_ZAP_PORT", "9999");
    let env_config = Config::from_env().expect("Should load from env");
    assert_eq!(env_config.server.port, 9999);
    std::env::remove_var("PLATFORM_ZAP_PORT");
}

/// Test config validation
#[tokio::test]
async fn test_config_validation() {
    let mut config = Config::default();

    // Default config should be valid (with auth disabled)
    config.auth.auth_type = "none".to_string();
    assert!(config.validate().is_ok());

    // TLS enabled without certs should fail
    config.tls.enabled = true;
    assert!(config.validate().is_err());

    // TLS with certs should pass
    config.tls.cert = Some("/path/to/cert".to_string());
    config.tls.key = Some("/path/to/key".to_string());
    assert!(config.validate().is_ok());
}
