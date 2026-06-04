//! Admin impersonation — view the portal as another user.
//!
//! Security model:
//!   • Only role level ≥ 3 (admin / global_admin) may impersonate.
//!   • Target must exist and must have a strictly lower role level.
//!   • The JWT cookie is unchanged throughout — the real session never changes.
//!   • Every request carries X-Impersonate-As; the auth middleware validates it
//!     on *every* request (no server-side session state required).
//!   • All audit log entries are written as
//!     "{real_admin} [acting as {target}]" so the action is never attributed
//!     solely to the impersonated user.
//!
//! GET /api/admin/impersonation/validate?email=... — pre-flight check.
//!   Returns the target user's display info so the frontend can confirm before
//!   starting the session.  Only returns fields safe to show (name, role) —
//!   never secrets.

use axum::{
    extract::{Query, State},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::middleware::AuthUser,
    db::roles,
    error::{AppError, Result},
    state::AppState,
};

#[derive(Deserialize)]
pub struct ValidateQuery {
    pub email: String,
}

#[derive(Serialize)]
pub struct ImpersonationTarget {
    pub email:        String,
    pub display_name: String,
    pub role:         String,
    pub role_level:   u8,
    /// Whether this admin is allowed to impersonate the target.
    pub allowed:      bool,
    /// Human-readable reason if not allowed.
    pub reason:       Option<String>,
}

/// GET /api/admin/impersonation/validate?email=target@example.com
///
/// Validates that the requesting admin is permitted to impersonate `email`
/// and returns enough display information for a confirmation UI.
/// Never starts a session — that is implicit in every subsequent request
/// that carries the X-Impersonate-As header.
pub async fn validate(
    State(state): State<AppState>,
    actor:        AuthUser,
    Query(q):     Query<ValidateQuery>,
) -> Result<Json<ImpersonationTarget>> {
    // Must be at least admin level to call this endpoint.
    if actor.real_level < 3 {
        return Err(AppError::Forbidden(
            "Only admins may use impersonation".into(),
        ));
    }

    let target_email = q.email.trim().to_lowercase();

    if target_email == actor.real_email {
        return Ok(Json(ImpersonationTarget {
            email:        target_email,
            display_name: "You".into(),
            role:         actor.real_role.clone(),
            role_level:   actor.real_level,
            allowed:      false,
            reason:       Some("You cannot impersonate yourself.".into()),
        }));
    }

    // Look up the target user.
    let row: Option<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT email, role, display_name FROM users WHERE email = ?",
    )
    .bind(&target_email)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| AppError::Internal(e.into()))?;

    let Some((email, role, display_name)) = row else {
        return Ok(Json(ImpersonationTarget {
            email:        target_email,
            display_name: "Unknown".into(),
            role:         "—".into(),
            role_level:   0,
            allowed:      false,
            reason:       Some("No portal account found for that email.".into()),
        }));
    };

    let tgt_level = roles::level_for(&state.pool, &role).await.min(255) as u8;
    let display   = display_name.unwrap_or_else(|| email.split('@').next().unwrap_or(&email).to_string());

    if tgt_level >= actor.real_level {
        return Ok(Json(ImpersonationTarget {
            email,
            display_name: display,
            role,
            role_level:   tgt_level,
            allowed:      false,
            reason:       Some(format!(
                "Cannot impersonate a user at the same or higher role level (theirs: {tgt_level}, yours: {}).",
                actor.real_level
            )),
        }));
    }

    Ok(Json(ImpersonationTarget {
        email,
        display_name: display,
        role,
        role_level:   tgt_level,
        allowed:      true,
        reason:       None,
    }))
}
