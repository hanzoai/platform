//! ZAP Server implementation

use crate::auth::JwtAuth;
use crate::config::Config;
use crate::error::{Error, Result};
use crate::interfaces::PlatformImpl;
use crate::trpc_bridge::TrpcBridge;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::signal;
use tokio::task::LocalSet;
use tokio_util::compat::TokioAsyncWriteCompatExt;
use tracing::{error, info};

/// Platform ZAP Server
pub struct Server {
    config: Config,
    trpc_bridge: Arc<TrpcBridge>,
    auth: Arc<JwtAuth>,
}

impl Server {
    /// Create a new server instance
    pub fn new(config: Config) -> Self {
        let trpc_bridge = Arc::new(
            TrpcBridge::new(&config.trpc.base_url, config.trpc.timeout_ms)
                .with_retries(config.trpc.max_retries, config.trpc.retry_delay_ms),
        );

        let auth = Arc::new(JwtAuth::new(
            config.auth.secret.as_deref().unwrap_or("default-secret"),
            "platform-zap",
        ));

        Self {
            config,
            trpc_bridge,
            auth,
        }
    }

    /// Run the server
    pub async fn run(&self) -> Result<()> {
        // Validate configuration
        self.config.validate()?;

        let addr: SocketAddr = format!("{}:{}", self.config.server.listen, self.config.server.port)
            .parse()
            .map_err(|e| Error::Config(format!("Invalid address: {}", e)))?;

        info!("Starting Platform ZAP server on {}", addr);

        // Create TCP listener
        let listener = TcpListener::bind(addr).await?;

        info!(
            "Platform ZAP server listening on {} (protocol version: {})",
            addr,
            crate::PROTOCOL_VERSION
        );

        // Use LocalSet because capnp_rpc futures are not Send
        let local = LocalSet::new();

        local.run_until(async move {
            // Main accept loop
            let shutdown = signal::ctrl_c();
            tokio::pin!(shutdown);

            loop {
                tokio::select! {
                    result = listener.accept() => {
                        match result {
                            Ok((stream, peer_addr)) => {
                                info!(%peer_addr, "New connection");

                                let trpc_bridge = self.trpc_bridge.clone();
                                let auth = self.auth.clone();
                                let config = self.config.clone();

                                // Use spawn_local for non-Send capnp_rpc futures
                                tokio::task::spawn_local(async move {
                                    if let Err(e) = Self::handle_connection(
                                        stream,
                                        peer_addr,
                                        trpc_bridge,
                                        auth,
                                        config,
                                    ).await {
                                        error!(%peer_addr, error = %e, "Connection error");
                                    }
                                });
                            }
                            Err(e) => {
                                error!(error = %e, "Accept error");
                            }
                        }
                    }
                    _ = &mut shutdown => {
                        info!("Shutdown signal received, stopping server");
                        break;
                    }
                }
            }

            info!("Server stopped");
        }).await;

        Ok(())
    }

    /// Handle a single connection
    async fn handle_connection(
        stream: tokio::net::TcpStream,
        peer_addr: SocketAddr,
        trpc_bridge: Arc<TrpcBridge>,
        auth: Arc<JwtAuth>,
        _config: Config,
    ) -> Result<()> {
        use capnp_rpc::{rpc_twoparty_capnp, twoparty, RpcSystem};
        use tokio_util::compat::TokioAsyncReadCompatExt;

        stream.set_nodelay(true)?;

        let (reader, writer) = stream.into_split();
        let reader = reader.compat();
        let writer = writer.compat_write();

        let network = twoparty::VatNetwork::new(
            reader,
            writer,
            rpc_twoparty_capnp::Side::Server,
            Default::default(),
        );

        // Create Platform capability
        let platform_impl = PlatformImpl::new(trpc_bridge, auth);
        let platform: crate::platform_capnp::platform::Client =
            capnp_rpc::new_client(platform_impl);

        let rpc_system = RpcSystem::new(Box::new(network), Some(platform.client));

        info!(%peer_addr, "RPC system started");

        rpc_system.await.map_err(Error::Capnp)?;

        info!(%peer_addr, "Connection closed");
        Ok(())
    }

    /// Generate a new auth token for testing/development
    pub fn generate_token(&self, subject: &str, organization_id: &str) -> Result<String> {
        self.auth
            .generate_token(subject, organization_id, vec![], vec![])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_creation() {
        let config = Config::default();
        let server = Server::new(config);

        assert!(server.config.server.port == 9998);
    }
}
