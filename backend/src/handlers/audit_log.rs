//! Audit log endpoints.
//!
//! GET /api/admin/audit-log          — last 200 entries (global_admin only)
//! GET /api/me/audit-log             — last 100 entries for the calling user

use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;

use crate::{
    auth::middleware::AuthUser,
    db::audit,
    error::Result,
    state::AppState,
};

#[derive(Deserialize)]
pub struct AuditParams {
    #[serde(default = "default_limit")]
    pub limit: i64,
}
fn default_limit() -> i64 { 200 }

/// GET /api/admin/audit-log  — global_admin only, full log
pub async fn list_global(
    State(state): State<AppState>,
    actor: AuthUser,
    Query(params): Query<AuditParams>,
) -> Result<Json<Vec<audit::AuditEntry>>> {
    crate::auth::middleware::require_perm(&actor, "users.permission_overrides.edit")?;
    let limit = params.limit.clamp(1, 500);
    Ok(Json(audit::list_recent(&state.pool, limit).await?))
}

/// GET /api/me/audit-log  — any authenticated user, own entries only
pub async fn list_own(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<Vec<audit::AuditEntry>>> {
    Ok(Json(audit::list_by_actor(&state.pool, &actor.email, 100).await?))
}
