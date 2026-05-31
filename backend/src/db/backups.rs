use crate::error::Result;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct BackupRun {
    pub id: i64,
    pub filename: String,
    /// Full path of the archive on mc-server-1.
    pub file_path: String,
    pub size_bytes: i64,
    pub created_by: String,
    pub created_at: String,
    pub notes: Option<String>,
    /// Set for world-scoped backups; NULL for legacy global backups.
    pub world_id:   Option<i64>,
    pub world_slug: Option<String>,
}

const SELECT: &str =
    "SELECT id, filename, file_path, size_bytes, created_by, created_at, notes, world_id, world_slug FROM backup_runs";

pub async fn list(pool: &SqlitePool) -> Result<Vec<BackupRun>> {
    Ok(
        sqlx::query_as::<_, BackupRun>(&format!("{SELECT} ORDER BY created_at DESC"))
            .fetch_all(pool)
            .await?,
    )
}

pub async fn get(pool: &SqlitePool, id: i64) -> Result<Option<BackupRun>> {
    Ok(
        sqlx::query_as::<_, BackupRun>(&format!("{SELECT} WHERE id = ?"))
            .bind(id)
            .fetch_optional(pool)
            .await?,
    )
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
         VALUES (?, ?, ?, ?)",
    )
    .bind(filename)
    .bind(file_path)
    .bind(size_bytes)
    .bind(created_by)
    .execute(pool)
    .await?;
    Ok(result.last_insert_rowid())
}

/// Insert a backup tagged to a specific world.
pub async fn insert_for_world(
    pool: &SqlitePool,
    filename: &str,
    file_path: &str,
    size_bytes: i64,
    created_by: &str,
    world_id: i64,
    world_slug: &str,
) -> Result<i64> {
    let result = sqlx::query(
        "INSERT INTO backup_runs (filename, file_path, size_bytes, created_by, world_id, world_slug)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(filename)
    .bind(file_path)
    .bind(size_bytes)
    .bind(created_by)
    .bind(world_id)
    .bind(world_slug)
    .execute(pool)
    .await?;
    Ok(result.last_insert_rowid())
}

/// List backups belonging to a specific world, ordered newest-first.
pub async fn list_by_world(
    pool: &SqlitePool,
    world_id: i64,
    world_slug: &str,
) -> Result<Vec<BackupRun>> {
    Ok(
        sqlx::query_as::<_, BackupRun>(&format!(
            "{SELECT} WHERE world_id = ? OR world_slug = ? ORDER BY created_at DESC"
        ))
        .bind(world_id)
        .bind(world_slug)
        .fetch_all(pool)
        .await?,
    )
}

pub async fn get_by_filename(pool: &SqlitePool, filename: &str) -> Result<Option<BackupRun>> {
    Ok(
        sqlx::query_as::<_, BackupRun>(&format!("{SELECT} WHERE filename = ?"))
            .bind(filename)
            .fetch_optional(pool)
            .await?,
    )
}

pub async fn remove(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("DELETE FROM backup_runs WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Patch the on-disk identifiers of an existing backup row.  Used by
/// the archival pass that recompresses old `.tar.gz` files to `.tar.xz`
/// in-place — the row's `id` / `created_at` / etc. stay the same, but
/// the filename / file_path / size_bytes all change.
pub async fn update_archive(
    pool: &SqlitePool,
    id: i64,
    new_filename: &str,
    new_file_path: &str,
    new_size_bytes: i64,
) -> Result<()> {
    sqlx::query(
        "UPDATE backup_runs \
            SET filename = ?, file_path = ?, size_bytes = ? \
          WHERE id = ?",
    )
    .bind(new_filename)
    .bind(new_file_path)
    .bind(new_size_bytes)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Find backups older than `days` days that are still in gzip form.
/// Used by the archival pass.  Skips already-archived (`.tar.xz`)
/// files so this is idempotent.
pub async fn list_archivable(pool: &SqlitePool, days: i64) -> Result<Vec<BackupRun>> {
    Ok(sqlx::query_as::<_, BackupRun>(&format!(
        "{SELECT} \
         WHERE filename LIKE '%.tar.gz' \
           AND datetime(created_at) < datetime('now', '-' || ? || ' days') \
         ORDER BY created_at ASC"
    ))
    .bind(days)
    .fetch_all(pool)
    .await?)
}

/// Check whether a backup filename is already in the database.
pub async fn exists_by_filename(pool: &SqlitePool, filename: &str) -> Result<bool> {
    let row: Option<(i64,)> = sqlx::query_as("SELECT id FROM backup_runs WHERE filename = ?")
        .bind(filename)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

/// Find auto-created backups (created_by = 'mc-server-1') that are
/// beyond the `keep_per_scope` most recent within each scope.  Scope =
/// world_slug for world-tagged backups, "__GLOBAL__" for legacy
/// scope-less ones.  Anything created by a real user (e.g. the
/// "Create backup now" button on the web UI) is exempt and never
/// returned — those are preserved indefinitely.
pub async fn list_pruneable(
    pool: &SqlitePool,
    keep_per_scope: i64,
) -> Result<Vec<BackupRun>> {
    Ok(sqlx::query_as::<_, BackupRun>(&format!(
        "{SELECT} \
         WHERE created_by = 'mc-server-1' AND id IN ( \
             SELECT id FROM ( \
                 SELECT id, ROW_NUMBER() OVER ( \
                     PARTITION BY COALESCE(world_slug, '__GLOBAL__') \
                     ORDER BY created_at DESC, id DESC \
                 ) AS rn \
                 FROM backup_runs WHERE created_by = 'mc-server-1' \
             ) WHERE rn > ? \
         )"
    ))
    .bind(keep_per_scope)
    .fetch_all(pool)
    .await?)
}
