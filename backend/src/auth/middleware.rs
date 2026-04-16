use axum::{async_trait, extract::FromRequestParts, http::request::Parts};
use axum_extra::extract::CookieJar;
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

use crate::{
    db::users::role_level,
    error::AppError,
    state::AppState,
};

pub const JWT_COOKIE: &str = "rc_session";
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
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub email: String,
    pub role: String,
}

impl AuthUser {
    pub fn level(&self) -> u8 {
        role_level(&self.role)
    }

    pub fn can_manage_users(&self)   -> bool { self.level() >= 3 }
    pub fn can_manage_admins(&self)  -> bool { self.level() >= 4 }
    pub fn can_control_server(&self) -> bool { self.level() >= 2 }
    pub fn can_write_config(&self)   -> bool { self.level() >= 3 }
    pub fn can_restore_backup(&self) -> bool { self.level() >= 3 }
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

        Ok(AuthUser { email: claims.sub, role: claims.role })
    }
}

/// Guard: returns Forbidden if the actor's role level is below `min_level`.
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
