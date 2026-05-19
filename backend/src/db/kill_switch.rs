use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

use crate::error::Result;

/// Current kill-switch state. `disabled_at = None` means "enabled (normal)".
#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct KillSwitch {
    pub disabled_at: Option<String>,
    pub reason: Option<String>,
    pub source: Option<String>,
}

impl KillSwitch {
    pub fn is_engaged(&self) -> bool {
        self.disabled_at.is_some()
    }
}

pub async fn status(pool: &SqlitePool) -> Result<KillSwitch> {
    Ok(sqlx::query_as::<_, KillSwitch>(
        "SELECT disabled_at, reason, source FROM kill_switch WHERE id = 1",
    )
    .fetch_one(pool)
    .await?)
}

/// Engage the kill-switch. Idempotent: repeated calls refresh the reason/source.
pub async fn engage(pool: &SqlitePool, reason: &str, source: &str) -> Result<()> {
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    sqlx::query("UPDATE kill_switch SET disabled_at = ?, reason = ?, source = ? WHERE id = 1")
        .bind(&now)
        .bind(reason)
        .bind(source)
        .execute(pool)
        .await?;
    tracing::warn!(%reason, %source, "Kill-switch engaged");
    Ok(())
}

pub async fn release(pool: &SqlitePool, actor: &str) -> Result<()> {
    sqlx::query(
        "UPDATE kill_switch SET disabled_at = NULL, reason = NULL, source = NULL WHERE id = 1",
    )
    .execute(pool)
    .await?;
    tracing::info!(%actor, "Kill-switch released");
    Ok(())
}
