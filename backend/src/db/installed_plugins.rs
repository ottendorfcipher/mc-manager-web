use crate::error::Result;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct InstalledPlugin {
    pub id:               i64,
    pub filename:         String,
    pub project_key:      Option<String>,
    pub declared_name:    Option<String>,
    pub version:          Option<String>,
    pub api_version:      Option<String>,
    pub depends_json:     String,
    pub softdepends_json: String,
    pub sha1:             Option<String>,
    pub size_bytes:       i64,
    pub update_available: i64,
    pub installed_by:     String,
    pub installed_at:     String,
    pub last_load_status: String,
    pub last_status_at:   Option<String>,
}

/// Find a single plugin by its in-jar declared name or its filename.
/// One indexed lookup instead of fetching the whole table and scanning.
pub async fn find_by_name(pool: &SqlitePool, name: &str) -> Result<Option<InstalledPlugin>> {
    Ok(sqlx::query_as::<_, InstalledPlugin>(
        "SELECT * FROM installed_plugins
          WHERE declared_name = ? OR filename = ?
          ORDER BY (declared_name = ?) DESC, installed_at DESC
          LIMIT 1",
    )
    .bind(name)
    .bind(name)
    .bind(name)
    .fetch_optional(pool)
    .await?)
}

#[allow(clippy::too_many_arguments)]
pub async fn upsert(
    pool:             &SqlitePool,
    filename:         &str,
    project_key:      Option<&str>,
    declared_name:    Option<&str>,
    version:          Option<&str>,
    api_version:      Option<&str>,
    depends_json:     &str,
    softdepends_json: &str,
    sha1:             Option<&str>,
    size_bytes:       i64,
    installed_by:     &str,
) -> Result<InstalledPlugin> {
    Ok(sqlx::query_as::<_, InstalledPlugin>(
        "INSERT INTO installed_plugins
            (filename, project_key, declared_name, version, api_version,
             depends_json, softdepends_json, sha1, size_bytes, installed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(filename) DO UPDATE SET
            project_key      = COALESCE(excluded.project_key, project_key),
            declared_name    = excluded.declared_name,
            version          = excluded.version,
            api_version      = excluded.api_version,
            depends_json     = excluded.depends_json,
            softdepends_json = excluded.softdepends_json,
            sha1             = excluded.sha1,
            size_bytes       = excluded.size_bytes
         RETURNING *",
    )
    .bind(filename)
    .bind(project_key)
    .bind(declared_name)
    .bind(version)
    .bind(api_version)
    .bind(depends_json)
    .bind(softdepends_json)
    .bind(sha1)
    .bind(size_bytes)
    .bind(installed_by)
    .fetch_one(pool)
    .await?)
}

pub async fn list(pool: &SqlitePool) -> Result<Vec<InstalledPlugin>> {
    Ok(sqlx::query_as::<_, InstalledPlugin>(
        "SELECT * FROM installed_plugins ORDER BY installed_at DESC",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn get_by_filename(pool: &SqlitePool, filename: &str) -> Result<Option<InstalledPlugin>> {
    Ok(sqlx::query_as::<_, InstalledPlugin>(
        "SELECT * FROM installed_plugins WHERE filename = ?",
    )
    .bind(filename)
    .fetch_optional(pool)
    .await?)
}

pub async fn set_health(pool: &SqlitePool, filename: &str, status: &str) -> Result<()> {
    sqlx::query(
        "UPDATE installed_plugins
            SET last_load_status = ?, last_status_at = datetime('now')
          WHERE filename = ?",
    )
    .bind(status)
    .bind(filename)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn set_update_available(
    pool: &SqlitePool,
    filename: &str,
    available: bool,
) -> Result<()> {
    sqlx::query(
        "UPDATE installed_plugins SET update_available = ? WHERE filename = ?",
    )
    .bind(if available { 1_i64 } else { 0_i64 })
    .bind(filename)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove(pool: &SqlitePool, filename: &str) -> Result<bool> {
    let r = sqlx::query("DELETE FROM installed_plugins WHERE filename = ?")
        .bind(filename)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}
