use axum::{extract::State, Json};
use serde::Deserialize;

use crate::{
    auth::middleware::AuthUser,
    db::plugin_jobs,
    error::Result,
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct InstallBody {
    pub project_key:  String,
    pub version_id:   Option<String>,
    pub auto_restart: bool,
}

pub async fn install(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<InstallBody>,
) -> Result<Json<serde_json::Value>> {
    crate::auth::middleware::require_perm(&actor, "plugins.manage")?;
    if body.project_key.trim().is_empty() {
        return Err(crate::error::AppError::BadRequest("project_key is required".into()));
    }

    // Check for a racing job.
    let active = plugin_jobs::list_active(&state.pool).await.unwrap_or_default();
    let racing = active.iter().any(|j| {
        j.project_key.as_deref() == Some(&body.project_key)
            && !matches!(j.state.as_str(), "done" | "failed" | "rolled_back")
    });
    if racing {
        return Err(crate::error::AppError::Conflict(
            "Another install is already in progress for this plugin".into()
        ));
    }

    let job = plugin_jobs::create(
        &state.pool,
        "install",
        Some(&body.project_key),
        body.version_id.as_deref(),
        &actor.email,
    ).await?;

    // Kick off the runner immediately in the background.
    let pool2 = state.pool.clone();
    let cfg2  = state.config.clone();
    let job_id = job.id;
    let auto_restart = body.auto_restart;
    tokio::spawn(async move {
        if let Err(e) = crate::minecraft::plugin_install::advance_job(&pool2, &cfg2, job_id).await {
            tracing::warn!("install: advance_job {job_id} failed: {e}");
            let _ = plugin_jobs::finish(&pool2, job_id, "failed", Some(&e.to_string())).await;
        }
        if auto_restart {
            let _ = crate::minecraft::plugin_install::trigger_restart_and_verify(&pool2, &cfg2).await;
        }
    });

    Ok(Json(serde_json::json!({ "job_id": job.id })))
}
