//! Session management for the signed-in user.
//!
//! GET  /api/me/sessions             — recent sign-ins (login history)
//! POST /api/me/sessions/revoke-all  — sign out everywhere (invalidate tokens)

use axum::{extract::State, Json};

use crate::{
    auth::middleware::AuthUser,
    db::login_events::{self, LoginEvent},
    error::Result,
    state::AppState,
};

/// Recent sign-ins for the real signed-in user (impersonation-agnostic).
pub async fn list(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<Vec<LoginEvent>>> {
    Ok(Json(login_events::list(&state.pool, &actor.real_email, 20).await?))
}

/// "Sign out everywhere" — invalidate every token issued for this user so far,
/// including the current one (the next request will 401 → re-login).
pub async fn revoke_all(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<axum::http::StatusCode> {
    login_events::revoke_all(&state.pool, &actor.real_email).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
