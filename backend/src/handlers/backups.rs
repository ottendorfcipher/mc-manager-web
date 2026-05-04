use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, StatusCode},
    response::Response,
    Json,
};

use crate::{
    auth::middleware::AuthUser,
    db::{audit, backups},
    error::{AppError, Result},
    minecraft::backup,
    state::AppState,
};

pub async fn list(
    State(state): State<AppState>,
    _: AuthUser,
) -> Result<Json<Vec<backups::BackupRun>>> {
    Ok(Json(backups::list(&state.pool).await?))
}

/// POST /api/backups
/// Runs the backup script on mc-server-1, syncs the new record into the DB,
/// and returns it. Requires `backups.create`.
pub async fn create(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<(StatusCode, Json<backups::BackupRun>)> {
    crate::auth::middleware::require_perm(&actor, "backups.create")?;

    let filename = backup::create(&state.config).await.map_err(|e| {
        tracing::error!(error = %e, "Backup creation failed");
        e
    })?;

    // Sync to pick up the new file (and any other new cron backups)
    backup::sync_into_db(&state.pool, &state.config).await;

    let run = backups::get_by_filename(&state.pool, &filename)
        .await?
        .ok_or_else(|| {
            AppError::Internal(anyhow::anyhow!(
                "Backup was created but not found in DB after sync"
            ))
        })?;

    audit::log(
        &state.pool,
        &actor.email,
        "create_backup",
        Some(&filename),
        Some("mc-server-1"),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(run)))
}

/// GET /api/backups/:id  — stream the .tar.gz directly from mc-server-1
pub async fn download(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<Response> {
    crate::auth::middleware::require_perm(&actor, "backups.download")?;
    let run = backups::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Backup {id} not found")))?;

    let stream = backup::stream_file(&state.config, &run.file_path)?;
    let body = Body::from_stream(stream);

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/gzip")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", run.filename),
        )
        .body(body)
        .unwrap())
}

/// DELETE /api/backups/:id — remove from mc-server-1 and from the DB
pub async fn delete(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "backups.delete")?;
    let run = backups::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Backup {id} not found")))?;

    // Delete the archive from mc-server-1, then remove the DB record
    backup::delete_remote(&state.config, &run.file_path).await?;
    backups::remove(&state.pool, id).await?;
    audit::log(
        &state.pool,
        &actor.email,
        "delete_backup",
        Some(&run.filename),
        None,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/backups/:id/restore
pub async fn restore(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    if !actor.can_restore_backup() {
        return Err(AppError::Forbidden("restore_backup required".into()));
    }
    let run = backups::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Backup {id} not found")))?;

    backup::restore(&state.config, &run.file_path).await?;
    audit::log(
        &state.pool,
        &actor.email,
        "restore_backup",
        Some(&run.filename),
        None,
    )
    .await?;
    Ok(StatusCode::ACCEPTED)
}
