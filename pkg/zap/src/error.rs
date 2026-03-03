//! Error types for platform-zap

use thiserror::Error;

/// Result type alias
pub type Result<T> = std::result::Result<T, Error>;

/// Platform ZAP errors
#[derive(Debug, Error)]
pub enum Error {
    /// Configuration error
    #[error("Configuration error: {0}")]
    Config(String),

    /// Authentication error
    #[error("Authentication error: {0}")]
    Auth(String),

    /// Authorization error
    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    /// Not found
    #[error("Not found: {0}")]
    NotFound(String),

    /// Invalid request
    #[error("Invalid request: {0}")]
    InvalidRequest(String),

    /// tRPC bridge error
    #[error("tRPC bridge error: {0}")]
    TrpcBridge(String),

    /// Cap'n Proto error
    #[error("Cap'n Proto error: {0}")]
    Capnp(#[from] capnp::Error),

    /// IO error
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// HTTP error
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    /// JSON error
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    /// Consensus error
    #[error("Consensus error: {0}")]
    Consensus(String),

    /// Insufficient consensus confidence
    #[error("Insufficient consensus confidence: {0}")]
    InsufficientConsensus(f64),

    /// Timeout
    #[error("Timeout: {0}")]
    Timeout(String),

    /// Internal error
    #[error("Internal error: {0}")]
    Internal(String),
}

impl Error {
    /// Convert to Cap'n Proto error
    pub fn to_capnp(&self) -> capnp::Error {
        capnp::Error::failed(self.to_string())
    }

    /// Check if error is retriable
    pub fn is_retriable(&self) -> bool {
        matches!(
            self,
            Error::Timeout(_) | Error::TrpcBridge(_) | Error::Http(_)
        )
    }
}

/// Convert from anyhow error
impl From<anyhow::Error> for Error {
    fn from(err: anyhow::Error) -> Self {
        Error::Internal(err.to_string())
    }
}
