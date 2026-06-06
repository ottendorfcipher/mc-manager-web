use axum::{extract::State, http::StatusCode};

use crate::{
    auth::middleware::AuthUser,
    db::plugin_jobs,
    error::{AppError, Result},
    state::AppState,
};

pub async fn undo_last(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "plugins.manage")?;
    // Find the most recent completed job with a backup_id.
    let recent = plugin_jobs::list_recent(&state.pool, 20).await?;
    let job = recent.iter()
        .find(|j| j.finished_at.is_some() && j.backup_id.is_some())
        .ok_or_else(|| AppError::NotFound(
            "No completed job with a safety backup found".into()
        ))?;

    let backup_id = job.backup_id.unwrap();
    let backup = crate::db::backups::get(&state.pool, backup_id).await?
        .ok_or_else(|| AppError::NotFound(
            format!("Backup {backup_id} not found in database")
        ))?;

    crate::minecraft::backup::restore(&state.config, &backup.file_path).await
        .map_err(|e| AppError::ExternalCommand(format!("Restore failed: {e}")))?;

    Ok(StatusCode::NO_CONTENT)
}
