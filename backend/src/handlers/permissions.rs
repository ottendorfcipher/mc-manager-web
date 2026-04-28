use axum::{extract::State, Json};

use crate::{
    auth::middleware::AuthUser,
    db::permissions::{self, Permission},
    error::Result,
    state::AppState,
};

/// GET /api/permissions — full permission catalog.
/// Requires `roles.view` (or legacy `users.permissions.edit`).
pub async fn list(State(state): State<AppState>, actor: AuthUser) -> Result<Json<Vec<Permission>>> {
    if !actor.has("roles.view") && !actor.has("users.permissions.edit") {
        return Err(crate::error::AppError::Forbidden(
            "roles.view required".into(),
        ));
    }
    Ok(Json(permissions::list_all(&state.pool).await?))
}
