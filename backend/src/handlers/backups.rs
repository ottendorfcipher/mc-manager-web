use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, StatusCode},
    response::Response,
    Json,
};
use tokio::fs::File;
use tokio_util::io::ReaderStream;

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

/// POST /api/backups  — trigger a new backup (member+)
pub async fn create(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<(StatusCode, Json<backups::BackupRun>)> {
    if !actor.can_control_server() {
        return Err(AppError::Forbidden("control_server required".into()));
    }
    let filename = backup::create(&state.config).await?;
    let path = state.config.backup_dir.join(&filename);
    let size = std::fs::metadata(&path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);

    let id = backups::insert(
        &state.pool,
        &filename,
        path.to_str().unwrap_or_default(),
        size,
        &actor.email,
    )
    .await?;

    let run = backups::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("insert failed")))?;

    audit::log(&state.pool, &actor.email, "create_backup", Some(&filename), None).await?;
    Ok((StatusCode::CREATED, Json(run)))
}

/// GET /api/backups/:id  — stream the .tar.gz file
pub async fn download(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<Response> {
    if !actor.can_control_server() {
        return Err(AppError::Forbidden("control_server required".into()));
    }
    let run = backups::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Backup {id} not found")))?;

    let file = File::open(&run.file_path).await?;
    let stream = ReaderStream::new(file);
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

/// DELETE /api/backups/:id
pub async fn delete(
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

    // Remove the file then the DB record
    let _ = std::fs::remove_file(&run.file_path);
    backups::remove(&state.pool, id).await?;
    audit::log(&state.pool, &actor.email, "delete_backup", Some(&run.filename), None).await?;
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

    backup::restore(&state.config, std::path::Path::new(&run.file_path)).await?;
    audit::log(&state.pool, &actor.email, "restore_backup", Some(&run.filename), None).await?;
    Ok(StatusCode::ACCEPTED)
}
