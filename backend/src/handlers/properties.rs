use std::collections::HashMap;
use axum::{extract::State, http::StatusCode, Json};

use crate::{
    auth::middleware::AuthUser,
    error::{AppError, Result},
    minecraft::properties,
    state::AppState,
};

pub async fn get_all(
    State(state): State<AppState>,
    _: AuthUser,
) -> Result<Json<HashMap<String, String>>> {
    Ok(Json(properties::get_all(&state.config).await?))
}

pub async fn update(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(updates): Json<HashMap<String, String>>,
) -> Result<StatusCode> {
    if !actor.can_write_config() {
        return Err(AppError::Forbidden("write_config required".into()));
    }
    // Guard: these keys must never be changed via the UI
    let locked = ["server-ip", "enable-rcon", "online-mode"];
    for key in &locked {
        if updates.contains_key(*key) {
            return Err(AppError::Forbidden(format!("{key} is locked")));
        }
    }
    properties::apply_updates(&state.config, &updates).await?;
    Ok(StatusCode::NO_CONTENT)
}
