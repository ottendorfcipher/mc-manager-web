use crate::error::Result;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PluginHealthEvent {
    pub id:              i64,
    pub plugin_filename: Option<String>,
    pub kind:            String,
    pub detail:          String,
    pub raw_line:        Option<String>,
    pub observed_at:     String,
}

pub async fn insert_event(
    pool:            &SqlitePool,
    plugin_filename: Option<&str>,
    kind:            &str,
    detail:          &str,
    raw_line:        Option<&str>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO plugin_health_events (plugin_filename, kind, detail, raw_line)
         VALUES (?, ?, ?, ?)",
    )
    .bind(plugin_filename)
    .bind(kind)
    .bind(detail)
    .bind(raw_line)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_recent(pool: &SqlitePool, limit: i64) -> Result<Vec<PluginHealthEvent>> {
    Ok(sqlx::query_as::<_, PluginHealthEvent>(
        "SELECT * FROM plugin_health_events ORDER BY observed_at DESC LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?)
}

pub async fn list_for_plugin(
    pool:     &SqlitePool,
    filename: &str,
    limit:    i64,
) -> Result<Vec<PluginHealthEvent>> {
    Ok(sqlx::query_as::<_, PluginHealthEvent>(
        "SELECT * FROM plugin_health_events
          WHERE plugin_filename = ?
          ORDER BY observed_at DESC
          LIMIT ?",
    )
    .bind(filename)
    .bind(limit)
    .fetch_all(pool)
    .await?)
}
