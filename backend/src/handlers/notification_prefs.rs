//! Per-user email notification preferences.
//!
//! GET  /api/me/notification-prefs  — current user's prefs (defaults if unset)
//! PUT  /api/me/notification-prefs  — update them

use axum::{extract::State, Json};

use crate::{
    auth::middleware::AuthUser,
    db::notification_prefs::{self, NotificationPrefs},
    error::Result,
    state::AppState,
};

pub async fn get(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<NotificationPrefs>> {
    Ok(Json(notification_prefs::get(&state.pool, &actor.email).await?))
}

pub async fn put(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<NotificationPrefs>,
) -> Result<Json<NotificationPrefs>> {
    notification_prefs::set(&state.pool, &actor.email, &body).await?;
    Ok(Json(body))
}
