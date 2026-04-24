use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    auth::middleware::{require_perm, AuthUser},
    db::permissions::{self, Permission},
    error::Result,
    state::AppState,
};

/// GET /api/permissions — full catalog (used by the admin UI).
pub async fn list(State(state): State<AppState>, actor: AuthUser) -> Result<Json<Vec<Permission>>> {
    require_perm(&actor, "users.permissions.edit")?;
    Ok(Json(permissions::list_all(&state.pool).await?))
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct RolePermissions {
    pub role: String,
    pub permissions: Vec<String>,
}

/// GET /api/roles/:role/permissions
pub async fn get_role(
    State(state): State<AppState>,
    Path(role): Path<String>,
    actor: AuthUser,
) -> Result<Json<RolePermissions>> {
    require_perm(&actor, "users.permissions.edit")?;
    Ok(Json(RolePermissions {
        permissions: permissions::for_role(&state.pool, &role).await?,
        role,
    }))
}

#[derive(Debug, Deserialize)]
pub struct UpdateRoleBody {
    pub permissions: Vec<String>,
}

/// PUT /api/roles/:role/permissions
pub async fn set_role(
    State(state): State<AppState>,
    Path(role): Path<String>,
    actor: AuthUser,
    Json(body): Json<UpdateRoleBody>,
) -> Result<Json<RolePermissions>> {
    require_perm(&actor, "users.permissions.edit")?;
    permissions::set_for_role(&state.pool, &role, &body.permissions).await?;
    Ok(Json(RolePermissions {
        permissions: permissions::for_role(&state.pool, &role).await?,
        role,
    }))
}
