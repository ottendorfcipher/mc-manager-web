use std::{collections::HashSet, sync::Arc};

use axum::{async_trait, extract::FromRequestParts, http::request::Parts};
use axum_extra::extract::CookieJar;
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

use crate::{
    db::permissions,
    error::AppError,
    state::AppState,
};

/// The only cookie name Firebase Hosting forwards through Cloud Run rewrites.
/// All other cookie names are stripped from both requests and responses.
pub const JWT_COOKIE: &str = "__session";
pub const JWT_EXPIRY_SECS: i64 = 8 * 3600;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,   // email
    pub role: String,
    pub exp: i64,
    pub iat: i64,
}

/// Extractor: reads the JWT cookie and validates it.
/// Injects `AuthUser` into handlers that declare it as a parameter.
/// Permissions are loaded from the DB on every request so admin-time changes
/// take effect without needing users to sign out.
/// `level` is loaded from the `roles` table so custom roles with arbitrary
/// levels work seamlessly alongside the five system roles.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub email: String,
    pub role: String,
    /// Numeric level loaded from the `roles` table (0 = lowest, 4 = global_admin).
    pub level: u8,
    pub permissions: Arc<HashSet<String>>,
}

impl AuthUser {
    /// Returns this user's role level.
    pub fn level(&self) -> u8 { self.level }

    /// Check a permission key (e.g. "server.vm.start").
    pub fn has(&self, key: &str) -> bool {
        self.permissions.contains(key)
    }

    // Legacy boolean helpers, retained so handler call sites keep compiling.
    // Each now delegates to the permission check.
    pub fn can_manage_users(&self)   -> bool { self.has("users.invite") || self.has("users.remove") }
    pub fn can_manage_admins(&self)  -> bool { self.has("users.permissions.edit") }
    pub fn can_control_server(&self) -> bool { self.has("server.vm.start") || self.has("server.service.start") }
    pub fn can_write_config(&self)   -> bool { self.has("config.write") }
    pub fn can_restore_backup(&self) -> bool { self.has("backups.restore") }
}

#[async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let jar = CookieJar::from_request_parts(parts, state)
            .await
            .map_err(|_| AppError::Unauthenticated)?;

        let token = jar
            .get(JWT_COOKIE)
            .map(|c| c.value().to_owned())
            .ok_or(AppError::Unauthenticated)?;

        let key = DecodingKey::from_secret(state.config.jwt_secret.as_bytes());
        let claims = decode::<Claims>(&token, &key, &Validation::new(Algorithm::HS256))
            .map_err(|_| AppError::Unauthenticated)?
            .claims;

        let perms = permissions::effective_for(&state.pool, &claims.sub, &claims.role)
            .await
            .map_err(|_| AppError::Unauthenticated)?;

        // Load role level from the DB so custom roles with arbitrary levels
        // work alongside the five built-in system roles.
        let level = crate::db::roles::level_for(&state.pool, &claims.role)
            .await
            .min(255) as u8;

        Ok(AuthUser {
            email:       claims.sub,
            role:        claims.role,
            level,
            permissions: Arc::new(perms),
        })
    }
}

/// Guard: returns Forbidden if the actor is missing the required permission.
pub fn require_perm(actor: &AuthUser, key: &str) -> crate::error::Result<()> {
    if !actor.has(key) {
        return Err(AppError::Forbidden(format!(
            "Role '{}' lacks permission '{key}'",
            actor.role
        )));
    }
    Ok(())
}

/// Guard: returns Forbidden if the actor's role level is below `min_level`.
#[allow(dead_code)] // Preserved for any caller still using level-based checks.
pub fn require_role(actor: &AuthUser, min_level: u8, action: &str) -> crate::error::Result<()> {
    if actor.level() < min_level {
        return Err(AppError::Forbidden(format!(
            "Role '{}' cannot perform '{action}'",
            actor.role
        )));
    }
    Ok(())
}

/// Issue a signed JWT for the given email/role.
pub fn issue_jwt(
    email: &str,
    role: &str,
    secret: &str,
) -> anyhow::Result<String> {
    use jsonwebtoken::{encode, EncodingKey, Header};

    let now = chrono::Utc::now().timestamp();
    let claims = Claims {
        sub: email.to_owned(),
        role: role.to_owned(),
        iat: now,
        exp: now + JWT_EXPIRY_SECS,
    };
    Ok(encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?)
}
