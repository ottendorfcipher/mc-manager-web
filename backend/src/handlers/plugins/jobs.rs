use axum::{extract::{Path, Query, State}, Json};
use serde::Deserialize;

use crate::{
    auth::middleware::AuthUser,
    db::plugin_jobs::{self, PluginJob},
    error::{AppError, Result},
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct JobListParams {
    pub active: Option<bool>,
    pub limit:  Option<i64>,
}

pub async fn get_job(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<Json<PluginJob>> {
    crate::auth::middleware::require_perm(&actor, "plugins.manage")?;
    let job = plugin_jobs::get(&state.pool, id).await?
        .ok_or_else(|| AppError::NotFound(format!("Job {id} not found")))?;
    Ok(Json(job))
}

pub async fn list_jobs(
    State(state): State<AppState>,
    actor: AuthUser,
    Query(params): Query<JobListParams>,
) -> Result<Json<Vec<PluginJob>>> {
    crate::auth::middleware::require_perm(&actor, "plugins.manage")?;
    let jobs = if params.active.unwrap_or(false) {
        plugin_jobs::list_active(&state.pool).await?
    } else {
        let limit = params.limit.unwrap_or(50);
        plugin_jobs::list_recent(&state.pool, limit).await?
    };
    Ok(Json(jobs))
}
