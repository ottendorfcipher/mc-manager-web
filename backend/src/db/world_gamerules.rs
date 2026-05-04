use chrono::Utc;
use serde::Serialize;
use sqlx::SqlitePool;
use ts_rs::TS;

use crate::error::Result;

#[derive(Debug, Clone, Serialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct GameruleEntry {
    pub rule: String,
    pub value: String,
    pub updated_by: String,
    pub updated_at: String,
}

/// Return all cached gamerule values as a map keyed by rule name.
pub async fn get_all(pool: &SqlitePool) -> Result<Vec<GameruleEntry>> {
    Ok(sqlx::query_as::<_, GameruleEntry>(
        "SELECT rule, value, updated_by, updated_at FROM world_gamerules ORDER BY rule",
    )
    .fetch_all(pool)
    .await?)
}

/// Upsert a single gamerule value.
pub async fn upsert(pool: &SqlitePool, rule: &str, value: &str, updated_by: &str) -> Result<()> {
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    sqlx::query(
        "INSERT INTO world_gamerules (rule, value, updated_by, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(rule) DO UPDATE SET
             value      = excluded.value,
             updated_by = excluded.updated_by,
             updated_at = excluded.updated_at",
    )
    .bind(rule)
    .bind(value)
    .bind(updated_by)
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(())
}
