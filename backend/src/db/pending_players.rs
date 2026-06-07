use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

use crate::error::Result;

#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct PendingPlayer {
    pub id: i64,
    pub ign: String,
    pub uuid: Option<String>,
    pub first_seen: String,
    pub last_attempted: String,
    pub attempt_count: i64,
    pub status: String,
}

/// Determine the admission action for an incoming player and persist the event.
///
/// Returns:
/// - `"allow"`  → IGN is linked to a site user, or first-ever connection (let them play once)
/// - `"kick"`   → pending (seen before, not yet linked); kick with a message
/// - `"ban"`    → explicitly rejected by an admin
/// Record a join attempt. Returns `(action, newly_pending)` where `action` is
/// the watchdog directive ("allow" | "kick" | "ban") and `newly_pending` is
/// true only when this call created a brand-new pending record (so the caller
/// can notify admins exactly once per new player).
pub async fn record_join(
    pool: &SqlitePool,
    ign: &str,
    uuid: Option<&str>,
) -> Result<(&'static str, bool)> {
    // 1. Already linked to a site user — always allow.
    let linked: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM player_links WHERE LOWER(ign) = LOWER(?)")
            .bind(ign)
            .fetch_one(pool)
            .await?;

    if linked > 0 {
        return Ok(("allow", false));
    }

    let now = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    // 2. Check existing pending record.
    let existing = sqlx::query_as::<_, PendingPlayer>(
        "SELECT * FROM pending_players WHERE LOWER(ign) = LOWER(?)",
    )
    .bind(ign)
    .fetch_optional(pool)
    .await?;

    match existing {
        None => {
            // First ever connection — add to the queue and let them play.
            sqlx::query(
                "INSERT INTO pending_players (ign, uuid, first_seen, last_attempted, attempt_count, status)
                 VALUES (?, ?, ?, ?, 1, 'pending')",
            )
            .bind(ign)
            .bind(uuid)
            .bind(&now)
            .bind(&now)
            .execute(pool)
            .await?;
            Ok(("allow", true))
        }
        Some(p) => {
            // Bump attempt counter and last_attempted timestamp.
            sqlx::query(
                "UPDATE pending_players
                 SET last_attempted = ?, attempt_count = attempt_count + 1
                 WHERE LOWER(ign) = LOWER(?)",
            )
            .bind(&now)
            .bind(ign)
            .execute(pool)
            .await?;

            match p.status.as_str() {
                "rejected" => Ok(("ban", false)),
                _ => Ok(("kick", false)), // pending — seen before but not linked
            }
        }
    }
}

pub async fn list_pending(pool: &SqlitePool) -> Result<Vec<PendingPlayer>> {
    Ok(sqlx::query_as::<_, PendingPlayer>(
        "SELECT * FROM pending_players WHERE status = 'pending' ORDER BY first_seen DESC",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn approve(pool: &SqlitePool, ign: &str) -> Result<()> {
    sqlx::query("UPDATE pending_players SET status = 'approved' WHERE LOWER(ign) = LOWER(?)")
        .bind(ign)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn reject(pool: &SqlitePool, ign: &str) -> Result<()> {
    sqlx::query("UPDATE pending_players SET status = 'rejected' WHERE LOWER(ign) = LOWER(?)")
        .bind(ign)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_rejected(pool: &SqlitePool) -> Result<Vec<PendingPlayer>> {
    Ok(sqlx::query_as::<_, PendingPlayer>(
        "SELECT * FROM pending_players WHERE status = 'rejected' ORDER BY last_attempted DESC",
    )
    .fetch_all(pool)
    .await?)
}

/// Move a rejected player back to pending so they can be re-evaluated.
pub async fn reinstate(pool: &SqlitePool, ign: &str) -> Result<()> {
    sqlx::query("UPDATE pending_players SET status = 'pending' WHERE LOWER(ign) = LOWER(?)")
        .bind(ign)
        .execute(pool)
        .await?;
    Ok(())
}
