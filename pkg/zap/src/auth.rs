//! Authentication for Platform ZAP Server

use crate::error::{Error, Result};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// JWT claims for ZAP authentication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// Subject (user or service ID)
    pub sub: String,

    /// Organization ID
    pub org: String,

    /// Expiration time (Unix timestamp)
    pub exp: u64,

    /// Issued at (Unix timestamp)
    pub iat: u64,

    /// Issuer
    pub iss: String,

    /// Allowed operations (optional restriction)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ops: Vec<String>,

    /// Allowed pools (optional restriction)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pools: Vec<String>,
}

/// Authentication context extracted from request
#[derive(Debug, Clone)]
pub struct AuthContext {
    /// Subject (user or service ID)
    pub subject: String,

    /// Organization ID
    pub organization_id: String,

    /// Allowed operations
    pub allowed_operations: Vec<String>,

    /// Allowed pools
    pub allowed_pools: Vec<String>,

    /// Raw token for forwarding to tRPC
    pub token: String,
}

impl AuthContext {
    /// Check if operation is allowed
    pub fn can_perform(&self, operation: &str) -> bool {
        // Empty means all operations allowed
        if self.allowed_operations.is_empty() {
            return true;
        }

        // Check for exact match or wildcard
        self.allowed_operations.iter().any(|op| {
            if op.ends_with('*') {
                let prefix = &op[..op.len() - 1];
                operation.starts_with(prefix)
            } else {
                op == operation
            }
        })
    }

    /// Check if pool access is allowed
    pub fn can_access_pool(&self, pool_id: &str) -> bool {
        // Empty means all pools allowed
        if self.allowed_pools.is_empty() {
            return true;
        }

        self.allowed_pools.iter().any(|p| p == pool_id || p == "*")
    }
}

/// JWT authenticator
pub struct JwtAuth {
    encoding_key: EncodingKey,
    decoding_key: DecodingKey,
    issuer: String,
    default_expiry: Duration,
}

impl JwtAuth {
    /// Create new JWT authenticator
    pub fn new(secret: &str, issuer: &str) -> Self {
        Self {
            encoding_key: EncodingKey::from_secret(secret.as_bytes()),
            decoding_key: DecodingKey::from_secret(secret.as_bytes()),
            issuer: issuer.to_string(),
            default_expiry: Duration::from_secs(3600),
        }
    }

    /// Set default token expiry
    pub fn with_expiry(mut self, expiry: Duration) -> Self {
        self.default_expiry = expiry;
        self
    }

    /// Generate a new token
    pub fn generate_token(
        &self,
        subject: &str,
        organization_id: &str,
        ops: Vec<String>,
        pools: Vec<String>,
    ) -> Result<String> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let claims = Claims {
            sub: subject.to_string(),
            org: organization_id.to_string(),
            exp: now + self.default_expiry.as_secs(),
            iat: now,
            iss: self.issuer.clone(),
            ops,
            pools,
        };

        encode(&Header::default(), &claims, &self.encoding_key)
            .map_err(|e| Error::Auth(format!("Failed to generate token: {}", e)))
    }

    /// Verify and extract claims from token
    pub fn verify_token(&self, token: &str) -> Result<AuthContext> {
        let mut validation = Validation::default();
        validation.set_issuer(&[&self.issuer]);

        let token_data = decode::<Claims>(token, &self.decoding_key, &validation)
            .map_err(|e| Error::Auth(format!("Invalid token: {}", e)))?;

        Ok(AuthContext {
            subject: token_data.claims.sub,
            organization_id: token_data.claims.org,
            allowed_operations: token_data.claims.ops,
            allowed_pools: token_data.claims.pools,
            token: token.to_string(),
        })
    }

    /// Extract bearer token from authorization header
    pub fn extract_bearer(header: &str) -> Result<&str> {
        if !header.starts_with("Bearer ") {
            return Err(Error::Auth("Invalid authorization header".to_string()));
        }
        Ok(&header[7..])
    }
}

/// Capability-based auth context
///
/// Represents a set of capabilities granted to a client.
/// Capabilities are unforgeable references that cannot be
/// created by the client.
#[derive(Debug, Clone)]
pub struct Capabilities {
    /// Organization ID
    pub organization_id: String,

    /// Cloud provider capabilities
    pub cloud: CloudCapability,

    /// Scaling capabilities
    pub scaling: ScalingCapability,

    /// Pool capabilities
    pub pool: PoolCapability,

    /// Infrastructure capabilities
    pub infra: InfraCapability,

    /// Deploy capabilities
    pub deploy: DeployCapability,
}

#[derive(Debug, Clone, Default)]
pub struct CloudCapability {
    pub can_configure: bool,
    pub can_read: bool,
    pub can_delete: bool,
}

#[derive(Debug, Clone, Default)]
pub struct ScalingCapability {
    pub can_scale_up: bool,
    pub can_scale_down: bool,
    pub can_resize: bool,
    pub max_nodes: Option<u32>,
}

#[derive(Debug, Clone, Default)]
pub struct PoolCapability {
    pub can_create: bool,
    pub can_read: bool,
    pub can_update: bool,
    pub can_delete: bool,
    pub allowed_pools: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct InfraCapability {
    pub can_manage_firewall: bool,
    pub can_manage_loadbalancer: bool,
}

#[derive(Debug, Clone, Default)]
pub struct DeployCapability {
    pub can_deploy: bool,
    pub can_stop: bool,
    pub can_delete: bool,
    pub allowed_projects: Vec<String>,
}

impl Capabilities {
    /// Create full admin capabilities
    pub fn admin(organization_id: &str) -> Self {
        Self {
            organization_id: organization_id.to_string(),
            cloud: CloudCapability {
                can_configure: true,
                can_read: true,
                can_delete: true,
            },
            scaling: ScalingCapability {
                can_scale_up: true,
                can_scale_down: true,
                can_resize: true,
                max_nodes: None,
            },
            pool: PoolCapability {
                can_create: true,
                can_read: true,
                can_update: true,
                can_delete: true,
                allowed_pools: vec![],
            },
            infra: InfraCapability {
                can_manage_firewall: true,
                can_manage_loadbalancer: true,
            },
            deploy: DeployCapability {
                can_deploy: true,
                can_stop: true,
                can_delete: true,
                allowed_projects: vec![],
            },
        }
    }

    /// Create read-only capabilities
    pub fn readonly(organization_id: &str) -> Self {
        Self {
            organization_id: organization_id.to_string(),
            cloud: CloudCapability {
                can_configure: false,
                can_read: true,
                can_delete: false,
            },
            scaling: ScalingCapability {
                can_scale_up: false,
                can_scale_down: false,
                can_resize: false,
                max_nodes: None,
            },
            pool: PoolCapability {
                can_create: false,
                can_read: true,
                can_update: false,
                can_delete: false,
                allowed_pools: vec![],
            },
            infra: InfraCapability {
                can_manage_firewall: false,
                can_manage_loadbalancer: false,
            },
            deploy: DeployCapability {
                can_deploy: false,
                can_stop: false,
                can_delete: false,
                allowed_projects: vec![],
            },
        }
    }

    /// Attenuate capabilities (restrict further)
    pub fn attenuate(&self, restrictions: &Capabilities) -> Self {
        Self {
            organization_id: self.organization_id.clone(),
            cloud: CloudCapability {
                can_configure: self.cloud.can_configure && restrictions.cloud.can_configure,
                can_read: self.cloud.can_read && restrictions.cloud.can_read,
                can_delete: self.cloud.can_delete && restrictions.cloud.can_delete,
            },
            scaling: ScalingCapability {
                can_scale_up: self.scaling.can_scale_up && restrictions.scaling.can_scale_up,
                can_scale_down: self.scaling.can_scale_down && restrictions.scaling.can_scale_down,
                can_resize: self.scaling.can_resize && restrictions.scaling.can_resize,
                max_nodes: match (self.scaling.max_nodes, restrictions.scaling.max_nodes) {
                    (Some(a), Some(b)) => Some(a.min(b)),
                    (Some(a), None) => Some(a),
                    (None, Some(b)) => Some(b),
                    (None, None) => None,
                },
            },
            pool: PoolCapability {
                can_create: self.pool.can_create && restrictions.pool.can_create,
                can_read: self.pool.can_read && restrictions.pool.can_read,
                can_update: self.pool.can_update && restrictions.pool.can_update,
                can_delete: self.pool.can_delete && restrictions.pool.can_delete,
                allowed_pools: if restrictions.pool.allowed_pools.is_empty() {
                    self.pool.allowed_pools.clone()
                } else {
                    self.pool
                        .allowed_pools
                        .iter()
                        .filter(|p| restrictions.pool.allowed_pools.contains(p))
                        .cloned()
                        .collect()
                },
            },
            infra: InfraCapability {
                can_manage_firewall: self.infra.can_manage_firewall
                    && restrictions.infra.can_manage_firewall,
                can_manage_loadbalancer: self.infra.can_manage_loadbalancer
                    && restrictions.infra.can_manage_loadbalancer,
            },
            deploy: DeployCapability {
                can_deploy: self.deploy.can_deploy && restrictions.deploy.can_deploy,
                can_stop: self.deploy.can_stop && restrictions.deploy.can_stop,
                can_delete: self.deploy.can_delete && restrictions.deploy.can_delete,
                allowed_projects: if restrictions.deploy.allowed_projects.is_empty() {
                    self.deploy.allowed_projects.clone()
                } else {
                    self.deploy
                        .allowed_projects
                        .iter()
                        .filter(|p| restrictions.deploy.allowed_projects.contains(p))
                        .cloned()
                        .collect()
                },
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_jwt_roundtrip() {
        let auth = JwtAuth::new("test-secret", "test-issuer");

        let token = auth
            .generate_token("user-123", "org-456", vec![], vec![])
            .unwrap();

        let context = auth.verify_token(&token).unwrap();

        assert_eq!(context.subject, "user-123");
        assert_eq!(context.organization_id, "org-456");
    }

    #[test]
    fn test_operation_check() {
        let context = AuthContext {
            subject: "user".to_string(),
            organization_id: "org".to_string(),
            allowed_operations: vec!["scaling.*".to_string(), "pool.read".to_string()],
            allowed_pools: vec![],
            token: "token".to_string(),
        };

        assert!(context.can_perform("scaling.scaleUp"));
        assert!(context.can_perform("scaling.scaleDown"));
        assert!(context.can_perform("pool.read"));
        assert!(!context.can_perform("pool.delete"));
        assert!(!context.can_perform("deploy.deploy"));
    }

    #[test]
    fn test_capability_attenuation() {
        let admin = Capabilities::admin("org-123");
        let readonly_restrictions = Capabilities::readonly("org-123");

        let attenuated = admin.attenuate(&readonly_restrictions);

        assert!(!attenuated.cloud.can_configure);
        assert!(attenuated.cloud.can_read);
        assert!(!attenuated.scaling.can_scale_up);
    }
}
