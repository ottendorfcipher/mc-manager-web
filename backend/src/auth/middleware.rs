use std::{collections::HashSet, sync::Arc};

use axum::{async_trait, extract::FromRequestParts, http::request::Parts};
use axum_extra::extract::CookieJar;
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

use crate::{db::permissions, error::AppError, state::AppState};

pub const JWT_COOKIE:      &str = "__session";
pub const JWT_EXPIRY_SECS: i64 = 8 * 3600;

/// Header name used by the frontend when an admin is acting on behalf of
/// another user.  The value is the target user's email address.
pub const IMPERSONATE_HEADER: &str = "x-impersonate-as";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub role: String,
    pub exp: i64,
    pub iat: i64,
}

/// Authenticated user context injected into every handler.
///
/// When an admin is impersonating another user:
///   • `email` / `role` / `level` / `permissions` reflect the **target** user
///     (so the portal renders and behaves as that user would see it).
///   • `real_email` / `real_role` / `real_level` are always the **actual**
///     signed-in admin — used for permission checks on the impersonation
///     operation itself and for all audit log entries.
///   • `impersonating_as` is `Some(target_email)`.
///
/// When NOT impersonating all fields are identical and `impersonating_as` is None.
#[derive(Debug, Clone)]
pub struct AuthUser {
    /// Effective email (target user when impersonating, own email otherwise).
    pub email: String,
    /// Effective role.
    pub role: String,
    /// Effective numeric level (0 = visitor … 4 = global_admin).
    pub level: u8,
    /// Effective permission set.
    pub permissions: Arc<HashSet<String>>,

    /// Always the real signed-in admin's email.
    pub real_email: String,
    /// Always the real signed-in admin's role.
    pub real_role: String,
    /// Always the real signed-in admin's level.
    pub real_level: u8,
    /// Some(target) when acting as another user, None otherwise.
    pub impersonating_as: Option<String>,
}

impl AuthUser {
    pub fn level(&self) -> u8 { self.level }
    pub fn has(&self, key: &str) -> bool { self.permissions.contains(key) }

    /// Label for audit log entries — always attributes the action to the real
    /// admin, with a suffix when impersonation is active so it is never hidden.
    pub fn audit_actor(&self) -> String {
        match &self.impersonating_as {
            Some(target) => format!("{} [acting as {}]", self.real_email, target),
            None         => self.real_email.clone(),
        }
    }

    pub fn is_impersonating(&self) -> bool { self.impersonating_as.is_some() }

    // Legacy helpers — kept for backwards compat.
    pub fn can_manage_users(&self)  -> bool { self.has("users.invite") || self.has("users.remove") }
    pub fn can_manage_admins(&self) -> bool { self.has("users.permissions.edit") }
    pub fn can_control_server(&self)-> bool { self.has("server.vm.start") || self.has("server.service.start") }
    pub fn can_write_config(&self)  -> bool { self.has("config.write") }
    pub fn can_restore_backup(&self)-> bool { self.has("backups.restore") }
}

#[async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        // ── 1. Validate the JWT (real signed-in user) ─────────────────────────
        let jar = CookieJar::from_request_parts(parts, state)
            .await
            .map_err(|_| AppError::Unauthenticated)?;

        let token = jar
            .get(JWT_COOKIE)
            .map(|c| c.value().to_owned())
            .ok_or(AppError::Unauthenticated)?;

        let key    = DecodingKey::from_secret(state.config.jwt_secret.as_bytes());
        let claims = decode::<Claims>(&token, &key, &Validation::new(Algorithm::HS256))
            .map_err(|_| AppError::Unauthenticated)?
            .claims;

        let real_email = claims.sub.clone();
        let real_role  = claims.role.clone();

        // Reject tokens issued before a "sign out everywhere" cutoff for this user.
        if claims.iat < crate::db::login_events::tokens_valid_after(&state.pool, &real_email).await {
            return Err(AppError::Unauthenticated);
        }
        let real_level = crate::db::roles::level_for(&state.pool, &real_role)
            .await
            .min(255) as u8;

        // ── 2. Check for impersonation header ─────────────────────────────────
        let target_email: Option<String> = parts
            .headers
            .get(IMPERSONATE_HEADER)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty() && s.contains('@'));

        if let Some(ref target) = target_email {
            // (a) Only admin (≥3) may use impersonation.
            if real_level < 3 {
                tracing::warn!(
                    actor = %real_email, target = %target,
                    "impersonation denied: actor is not an admin",
                );
                return Err(AppError::Forbidden(
                    "Only admins may use impersonation".into(),
                ));
            }
            // (b) Cannot impersonate yourself.
            if *target == real_email {
                return Err(AppError::BadRequest(
                    "Cannot impersonate yourself".into(),
                ));
            }
            // (c) Target must exist.
            let row = sqlx::query_as::<_, (String, String)>(
                "SELECT email, role FROM users WHERE email = ?",
            )
            .bind(target)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| AppError::Internal(e.into()))?
            .ok_or_else(|| AppError::NotFound(format!("User '{target}' not found")))?;

            let (_tgt_email, tgt_role) = row;
            let tgt_level = crate::db::roles::level_for(&state.pool, &tgt_role)
                .await
                .min(255) as u8;

            // (d) Cannot impersonate a peer or superior.
            if tgt_level >= real_level {
                return Err(AppError::Forbidden(
                    "Cannot impersonate a user at the same or higher role level".into(),
                ));
            }

            let tgt_perms = permissions::effective_for(&state.pool, target, &tgt_role)
                .await
                .map_err(|_| AppError::Unauthenticated)?;

            // Intersect with the real admin's own permissions so impersonation
            // can never grant a capability the admin does not personally hold.
            let real_perms = permissions::effective_for(&state.pool, &real_email, &real_role)
                .await
                .map_err(|_| AppError::Unauthenticated)?;
            let effective: HashSet<String> =
                tgt_perms.intersection(&real_perms).cloned().collect();

            tracing::info!(
                real = %real_email,
                target = %target,
                "impersonation: session active",
            );

            return Ok(AuthUser {
                email:            target.clone(),
                role:             tgt_role,
                level:            tgt_level,
                permissions:      Arc::new(effective),
                real_email,
                real_role,
                real_level,
                impersonating_as: Some(target.clone()),
            });
        }

        // ── 3. Normal (non-impersonated) path ─────────────────────────────────
        let perms = permissions::effective_for(&state.pool, &real_email, &real_role)
            .await
            .map_err(|_| AppError::Unauthenticated)?;

        Ok(AuthUser {
            email:            real_email.clone(),
            role:             real_role.clone(),
            level:            real_level,
            permissions:      Arc::new(perms),
            real_email,
            real_role,
            real_level,
            impersonating_as: None,
        })
    }
}

pub fn require_perm(actor: &AuthUser, key: &str) -> crate::error::Result<()> {
    if !actor.has(key) {
        tracing::warn!(
            actor = %actor.audit_actor(), permission = %key, role = %actor.role,
            "permission denied",
        );
        return Err(AppError::Forbidden(format!(
            "Role '{}' lacks permission '{key}'",
            actor.role
        )));
    }
    Ok(())
}

#[allow(dead_code)]
pub fn require_role(actor: &AuthUser, min_level: u8, action: &str) -> crate::error::Result<()> {
    if actor.level() < min_level {
        return Err(AppError::Forbidden(format!(
            "Role '{}' cannot perform '{action}'",
            actor.role
        )));
    }
    Ok(())
}

pub fn issue_jwt(email: &str, role: &str, secret: &str) -> anyhow::Result<String> {
    use jsonwebtoken::{encode, EncodingKey, Header};
    let now = chrono::Utc::now().timestamp();
    let claims = Claims {
        sub:  email.to_owned(),
        role: role.to_owned(),
        iat:  now,
        exp:  now + JWT_EXPIRY_SECS,
    };
    Ok(encode(&Header::default(), &claims, &EncodingKey::from_secret(secret.as_bytes()))?)
}
