use axum::{extract::{Path, State}, Json};

use crate::{
    auth::middleware::AuthUser,
    db::{installed_plugins, plugin_jobs},
    error::{AppError, Result},
    state::AppState,
};

pub async fn update_plugin(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(filename): Path<String>,
) -> Result<Json<serde_json::Value>> {
    let plugin = installed_plugins::get_by_filename(&state.pool, &filename).await?
        .ok_or_else(|| AppError::NotFound(format!("Plugin '{filename}' not installed")))?;

    let project_key = plugin.project_key
        .ok_or_else(|| AppError::BadRequest(
            "Cannot auto-update manually uploaded plugins".into()
        ))?;

    let job = plugin_jobs::create(
        &state.pool,
        "update",
        Some(&project_key),
        None,
        &actor.email,
    ).await?;

    let pool2 = state.pool.clone();
    let cfg2  = state.config.clone();
    let job_id = job.id;
    tokio::spawn(async move {
        if let Err(e) = crate::minecraft::plugin_install::advance_job(&pool2, &cfg2, job_id).await {
            tracing::warn!("update_plugin: advance_job {job_id} failed: {e}");
            let _ = plugin_jobs::finish(&pool2, job_id, "failed", Some(&e.to_string())).await;
        }
    });

    Ok(Json(serde_json::json!({ "job_id": job.id })))
}

pub async fn update_all(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<serde_json::Value>> {
    let plugins = installed_plugins::list(&state.pool).await?;
    let updatable: Vec<_> = plugins.into_iter()
        .filter(|p| p.update_available != 0 && p.project_key.is_some())
        .collect();

    let mut job_ids: Vec<i64> = vec![];

    for plugin in updatable {
        let Some(project_key) = plugin.project_key else { continue };
        let job = plugin_jobs::create(
            &state.pool,
            "update",
            Some(&project_key),
            None,
            &actor.email,
        ).await?;
        job_ids.push(job.id);

        let pool2 = state.pool.clone();
        let cfg2  = state.config.clone();
        let job_id = job.id;
        tokio::spawn(async move {
            if let Err(e) = crate::minecraft::plugin_install::advance_job(&pool2, &cfg2, job_id).await {
                tracing::warn!("update_all: advance_job {job_id} failed: {e}");
                let _ = plugin_jobs::finish(&pool2, job_id, "failed", Some(&e.to_string())).await;
            }
        });
    }

    Ok(Json(serde_json::json!({ "job_ids": job_ids })))
}
