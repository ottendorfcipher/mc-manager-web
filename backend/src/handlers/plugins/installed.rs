use axum::{extract::{Path, State}, Json};

use crate::{
    auth::middleware::AuthUser,
    db::{installed_plugins, plugin_jobs},
    error::{AppError, Result},
    state::AppState,
};

pub async fn list(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<Vec<installed_plugins::InstalledPlugin>>> {
    crate::auth::middleware::require_perm(&actor, "nav.plugins")?;
    let plugins = installed_plugins::list(&state.pool).await?;
    Ok(Json(plugins))
}

pub async fn remove(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(filename): Path<String>,
) -> Result<Json<serde_json::Value>> {
    crate::auth::middleware::require_perm(&actor, "plugins.manage")?;
    // Verify the plugin exists.
    let existing = installed_plugins::get_by_filename(&state.pool, &filename).await?;
    if existing.is_none() {
        return Err(AppError::NotFound(format!("Plugin '{filename}' not installed")));
    }

    // Use project_key field to pass the filename to the remove job.
    let job = plugin_jobs::create(
        &state.pool,
        "remove",
        Some(&filename),
        None,
        &actor.email,
    ).await?;

    let pool2 = state.pool.clone();
    let cfg2  = state.config.clone();
    let job_id = job.id;
    tokio::spawn(async move {
        if let Err(e) = crate::minecraft::plugin_install::advance_job(&pool2, &cfg2, job_id).await {
            tracing::warn!("remove: advance_job {job_id} failed: {e}");
            let _ = plugin_jobs::finish(&pool2, job_id, "failed", Some(&e.to_string())).await;
        }
    });

    Ok(Json(serde_json::json!({ "job_id": job.id })))
}
