//! Per-user email notification preferences.
//!
//! A missing row means "all categories enabled" (the sensible default for a
//! freshly-added admin).

use crate::error::Result;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct NotificationPrefs {
    pub pending_player: bool,
    pub world_switch:   bool,
    pub kill_switch:    bool,
}

impl Default for NotificationPrefs {
    fn default() -> Self {
        Self { pending_player: true, world_switch: true, kill_switch: true }
    }
}

impl NotificationPrefs {
    /// Whether a given notification category is enabled.
    pub fn enabled(&self, category: &str) -> bool {
        match category {
            "pending_player" => self.pending_player,
            "world_switch"   => self.world_switch,
            "kill_switch"    => self.kill_switch,
            _ => false,
        }
    }
}

/// Get a user's prefs (defaults if no row exists).
pub async fn get(pool: &SqlitePool, email: &str) -> Result<NotificationPrefs> {
    let row = sqlx::query_as::<_, NotificationPrefs>(
        "SELECT pending_player, world_switch, kill_switch
           FROM user_notification_prefs WHERE email = ?",
    )
    .bind(email)
    .fetch_optional(pool)
    .await?;
    Ok(row.unwrap_or_default())
}

/// Upsert a user's prefs.
pub async fn set(pool: &SqlitePool, email: &str, p: &NotificationPrefs) -> Result<()> {
    sqlx::query(
        "INSERT INTO user_notification_prefs
            (email, pending_player, world_switch, kill_switch, updated_at)
         VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
         ON CONFLICT(email) DO UPDATE SET
            pending_player = excluded.pending_player,
            world_switch   = excluded.world_switch,
            kill_switch    = excluded.kill_switch,
            updated_at     = excluded.updated_at",
    )
    .bind(email)
    .bind(p.pending_player)
    .bind(p.world_switch)
    .bind(p.kill_switch)
    .execute(pool)
    .await?;
    Ok(())
}
