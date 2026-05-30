//! Scheduled-job data access.

use crate::error::Result;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ScheduledJob {
    pub id:             i64,
    pub name:           String,
    pub cron_expr:      String,
    pub action_type:    String,
    pub action_payload: String,
    pub enabled:        i64,
    pub last_fire_at:   Option<String>,
    pub next_fire_at:   Option<String>,
    pub last_status:    Option<String>,
    pub created_by:     String,
    pub created_at:     String,
}

#[allow(clippy::too_many_arguments)]
pub async fn create(
    pool:           &SqlitePool,
    name:           &str,
    cron_expr:      &str,
    action_type:    &str,
    action_payload: &str,
    next_fire_at:   &str,
    created_by:     &str,
) -> Result<ScheduledJob> {
    Ok(sqlx::query_as::<_, ScheduledJob>(
        "INSERT INTO scheduled_jobs
            (name, cron_expr, action_type, action_payload, next_fire_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING *",
    )
    .bind(name)
    .bind(cron_expr)
    .bind(action_type)
    .bind(action_payload)
    .bind(next_fire_at)
    .bind(created_by)
    .fetch_one(pool)
    .await?)
}

pub async fn list(pool: &SqlitePool) -> Result<Vec<ScheduledJob>> {
    Ok(sqlx::query_as::<_, ScheduledJob>(
        "SELECT * FROM scheduled_jobs ORDER BY enabled DESC, name ASC",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn get(pool: &SqlitePool, id: i64) -> Result<Option<ScheduledJob>> {
    Ok(sqlx::query_as::<_, ScheduledJob>("SELECT * FROM scheduled_jobs WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?)
}

/// Rows that are enabled and due before `now` (ISO-8601 UTC string).
pub async fn due_before(pool: &SqlitePool, now: &str) -> Result<Vec<ScheduledJob>> {
    Ok(sqlx::query_as::<_, ScheduledJob>(
        "SELECT * FROM scheduled_jobs
          WHERE enabled = 1
            AND next_fire_at IS NOT NULL
            AND next_fire_at <= ?",
    )
    .bind(now)
    .fetch_all(pool)
    .await?)
}

#[allow(clippy::too_many_arguments)]
pub async fn update(
    pool:           &SqlitePool,
    id:             i64,
    name:           &str,
    cron_expr:      &str,
    action_type:    &str,
    action_payload: &str,
    next_fire_at:   Option<&str>,
    enabled:        bool,
) -> Result<bool> {
    let r = sqlx::query(
        "UPDATE scheduled_jobs SET
            name = ?, cron_expr = ?, action_type = ?, action_payload = ?,
            next_fire_at = COALESCE(?, next_fire_at), enabled = ?
          WHERE id = ?",
    )
    .bind(name)
    .bind(cron_expr)
    .bind(action_type)
    .bind(action_payload)
    .bind(next_fire_at)
    .bind(if enabled { 1_i64 } else { 0_i64 })
    .bind(id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn record_fire(
    pool: &SqlitePool,
    id:   i64,
    last_fire_at: &str,
    next_fire_at: &str,
    last_status:  &str,
) -> Result<()> {
    sqlx::query(
        "UPDATE scheduled_jobs
            SET last_fire_at = ?, next_fire_at = ?, last_status = ?
          WHERE id = ?",
    )
    .bind(last_fire_at)
    .bind(next_fire_at)
    .bind(last_status)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete(pool: &SqlitePool, id: i64) -> Result<bool> {
    let r = sqlx::query("DELETE FROM scheduled_jobs WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}
