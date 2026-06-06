use axum::{extract::State, http::StatusCode};

use crate::{
    auth::middleware::AuthUser,
    error::Result,
    minecraft::plugin_install,
    state::AppState,
};

pub async fn restart_for_plugins(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "plugins.manage")?;
    plugin_install::trigger_restart_and_verify(&state.pool, &state.config)
        .await
        .map_err(|e| crate::error::AppError::ExternalCommand(e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}
