use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;
use crate::error::Result;

#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct BackupRun {
    pub id:               i64,
    pub filename:         String,
    pub file_path:        String,
    pub size_bytes:       i64,
    pub created_by:       String,
    pub created_at:       String,
    pub notes:            Option<String>,
    /// 'local' | 'cloud' | 'both'
    pub storage_location: String,
    /// gs://bucket/backups/filename — None for local-only backups.
    pub gcs_uri:            Option<String>,
    /// 1 = stored under the 1-year lifecycle prefix, 0 = 30-day prefix.
    pub extended_retention: bool,
}

const SELECT: &str =
    "SELECT id, filename, file_path, size_bytes, created_by, created_at, notes,
            storage_location, gcs_uri, extended_retention FROM backup_runs";

pub async fn list(pool: &SqlitePool) -> Result<Vec<BackupRun>> {
    Ok(sqlx::query_as::<_, BackupRun>(
        &format!("{SELECT} ORDER BY created_at DESC")
    )
    .fetch_all(pool)
    .await?)
}

pub async fn get(pool: &SqlitePool, id: i64) -> Result<Option<BackupRun>> {
    Ok(sqlx::query_as::<_, BackupRun>(
        &format!("{SELECT} WHERE id = ?")
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

pub async fn insert(
    pool: &SqlitePool,
    filename: &str,
    file_path: &str,
    size_bytes: i64,
    created_by: &str,
    storage_location: &str,
    gcs_uri: Option<&str>,
    extended_retention: bool,
) -> Result<i64> {
    let result = sqlx::query(
        "INSERT INTO backup_runs (filename, file_path, size_bytes, created_by, storage_location, gcs_uri, extended_retention)
         VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(filename)
    .bind(file_path)
    .bind(size_bytes)
    .bind(created_by)
    .bind(storage_location)
    .bind(gcs_uri)
    .bind(extended_retention)
    .execute(pool)
    .await?;
    let id = result.last_insert_rowid();
    Ok(id)
}

pub async fn remove(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("DELETE FROM backup_runs WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Scan the backup directory and sync metadata for any .tar.gz files
/// not yet recorded. Called at startup for migration compatibility.
pub async fn sync_from_dir(
    pool: &SqlitePool,
    dir: &std::path::Path,
    created_by: &str,
) -> anyhow::Result<usize> {
    if !dir.exists() {
        return Ok(0);
    }
    let mut count = 0usize;
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("gz") {
            continue;
        }
        let filename = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        let existing: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM backup_runs WHERE filename = ?")
            .bind(&filename)
            .fetch_optional(pool)
            .await?;
        if existing.is_none() {
            let size = entry.metadata()?.len() as i64;
            insert(pool, &filename, path.to_str().unwrap_or_default(), size, created_by, "local", None, false).await?;
            count += 1;
        }
    }
    Ok(count)
}
