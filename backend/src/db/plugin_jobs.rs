use crate::error::Result;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PluginJob {
    pub id:             i64,
    pub kind:           String,
    pub project_key:    Option<String>,
    pub target_version: Option<String>,
    pub requested_by:   String,
    pub requested_at:   String,
    pub state:          String,
    pub state_detail:   Option<String>,
    pub plan_json:      Option<String>,
    pub backup_id:      Option<i64>,
    pub audit_id:       Option<i64>,
    pub finished_at:    Option<String>,
}

pub async fn create(
    pool:           &SqlitePool,
    kind:           &str,
    project_key:    Option<&str>,
    target_version: Option<&str>,
    requested_by:   &str,
) -> Result<PluginJob> {
    Ok(sqlx::query_as::<_, PluginJob>(
        "INSERT INTO plugin_jobs (kind, project_key, target_version, requested_by)
         VALUES (?, ?, ?, ?)
         RETURNING *",
    )
    .bind(kind)
    .bind(project_key)
    .bind(target_version)
    .bind(requested_by)
    .fetch_one(pool)
    .await?)
}

pub async fn get(pool: &SqlitePool, id: i64) -> Result<Option<PluginJob>> {
    Ok(sqlx::query_as::<_, PluginJob>(
        "SELECT * FROM plugin_jobs WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

pub async fn list_active(pool: &SqlitePool) -> Result<Vec<PluginJob>> {
    Ok(sqlx::query_as::<_, PluginJob>(
        "SELECT * FROM plugin_jobs
          WHERE state NOT IN ('done', 'failed', 'rolled_back')
          ORDER BY requested_at DESC",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn list_recent(pool: &SqlitePool, limit: i64) -> Result<Vec<PluginJob>> {
    Ok(sqlx::query_as::<_, PluginJob>(
        "SELECT * FROM plugin_jobs ORDER BY requested_at DESC LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?)
}

pub async fn set_state(
    pool:   &SqlitePool,
    id:     i64,
    state:  &str,
    detail: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "UPDATE plugin_jobs SET state = ?, state_detail = ? WHERE id = ?",
    )
    .bind(state)
    .bind(detail)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn set_plan(pool: &SqlitePool, id: i64, plan_json: &str) -> Result<()> {
    sqlx::query("UPDATE plugin_jobs SET plan_json = ? WHERE id = ?")
        .bind(plan_json)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_backup(pool: &SqlitePool, id: i64, backup_id: i64) -> Result<()> {
    sqlx::query("UPDATE plugin_jobs SET backup_id = ? WHERE id = ?")
        .bind(backup_id)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn finish(
    pool:   &SqlitePool,
    id:     i64,
    state:  &str,
    detail: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "UPDATE plugin_jobs
            SET state = ?, state_detail = ?, finished_at = datetime('now')
          WHERE id = ?",
    )
    .bind(state)
    .bind(detail)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}
