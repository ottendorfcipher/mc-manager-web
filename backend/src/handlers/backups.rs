use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, StatusCode},
    response::Response,
    Json,
};
use serde::Deserialize;
use tokio::fs::File;
use tokio_util::io::ReaderStream;

use crate::{
    auth::middleware::AuthUser,
    db::{audit, backups},
    error::{AppError, Result},
    minecraft::backup,
    state::AppState,
};

#[derive(Deserialize, Default)]
pub struct CreateBackupParams {
    /// "local" (default) or "cloud".
    #[serde(default)]
    pub storage: String,
    /// When true (and storage=cloud), store under the 1-year GCS prefix.
    #[serde(default)]
    pub extended: bool,
}

pub async fn list(
    State(state): State<AppState>,
    _: AuthUser,
) -> Result<Json<Vec<backups::BackupRun>>> {
    Ok(Json(backups::list(&state.pool).await?))
}

/// POST /api/backups  — trigger a new backup
/// Body: `{ "storage": "local" | "cloud" }` (storage defaults to "local").
/// Requires `backups.create` for local; also needs `backups.create.cloud` for cloud.
pub async fn create(
    State(state): State<AppState>,
    actor: AuthUser,
    // Accept optional JSON body; fall back gracefully if body is absent.
    body: Option<Json<CreateBackupParams>>,
) -> Result<(StatusCode, Json<backups::BackupRun>)> {
    crate::auth::middleware::require_perm(&actor, "backups.create")?;

    let params = body.map(|b| b.0).unwrap_or_default();
    let upload_to_cloud = params.storage == "cloud";
    let extended_retention = upload_to_cloud && params.extended;

    if upload_to_cloud {
        crate::auth::middleware::require_perm(&actor, "backups.create.cloud")?;
        if state.config.gcs_backup_bucket.is_none() {
            return Err(AppError::Internal(anyhow::anyhow!(
                "GCS_BACKUP_BUCKET is not configured on this server"
            )));
        }
    }
    if extended_retention {
        crate::auth::middleware::require_perm(&actor, "backups.create.extended")?;
    }

    let result = backup::create(&state.config, upload_to_cloud, extended_retention).await?;
    let path = state.config.backup_dir.join(&result.filename);
    let size = std::fs::metadata(&path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);

    let storage_location = match (true, upload_to_cloud) {
        (_, true)  => "cloud",
        _          => "local",
    };

    let id = backups::insert(
        &state.pool,
        &result.filename,
        path.to_str().unwrap_or_default(),
        size,
        &actor.email,
        storage_location,
        result.gcs_uri.as_deref(),
        result.extended_retention,
    )
    .await?;

    let run = backups::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("insert failed")))?;

    let detail = result.gcs_uri.as_deref().unwrap_or("local");
    audit::log(&state.pool, &actor.email, "create_backup", Some(&result.filename), Some(detail)).await?;
    Ok((StatusCode::CREATED, Json(run)))
}

/// GET /api/backups/:id  — stream the .tar.gz file
pub async fn download(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<Response> {
    crate::auth::middleware::require_perm(&actor, "backups.download")?;
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
    crate::auth::middleware::require_perm(&actor, "backups.delete")?;
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
