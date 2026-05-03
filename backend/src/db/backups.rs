use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;
use crate::error::Result;

#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct BackupRun {
    pub id:         i64,
    pub filename:   String,
    /// Full path of the archive on mc-server-1,
    /// e.g. `/opt/minecraft/backups/daily/2026-05-03_04-00.tar.gz`
    pub file_path:  String,
    pub size_bytes: i64,
    pub created_by: String,
    pub created_at: String,
    pub notes:      Option<String>,
}

const SELECT: &str =
    "SELECT id, filename, file_path, size_bytes, created_by, created_at, notes FROM backup_runs";

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
) -> Result<i64> {
    let result = sqlx::query(
        "INSERT INTO backup_runs (filename, file_path, size_bytes, created_by)
         VALUES (?, ?, ?, ?)"
    )
    .bind(filename)
    .bind(file_path)
    .bind(size_bytes)
    .bind(created_by)
    .execute(pool)
    .await?;
    let id = result.last_insert_rowid();
    Ok(id)
}

pub async fn get_by_filename(pool: &SqlitePool, filename: &str) -> Result<Option<BackupRun>> {
    Ok(sqlx::query_as::<_, BackupRun>(
        &format!("{SELECT} WHERE filename = ?")
    )
    .bind(filename)
    .fetch_optional(pool)
    .await?)
}

pub async fn remove(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("DELETE FROM backup_runs WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Check whether a backup filename is already in the database.
pub async fn exists_by_filename(pool: &SqlitePool, filename: &str) -> Result<bool> {
    let row: Option<(i64,)> = sqlx::query_as(
        "SELECT id FROM backup_runs WHERE filename = ?")
        .bind(filename)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}
