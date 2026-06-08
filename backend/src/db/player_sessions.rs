//! Play-session tracking → activity insights.
//!
//! The chat-watcher calls [`start`] on a join line and [`end`] on a leave line.
//! Open sessions (no leave seen — e.g. a backend restart) are closed lazily:
//! [`start`] closes any dangling open session for that player first, and the
//! insights query treats a still-open session as ending "now".

use crate::error::Result;
use serde::Serialize;
use sqlx::SqlitePool;
use ts_rs::TS;

/// Begin a session for `ign`, closing any dangling open one first.
pub async fn start(pool: &SqlitePool, ign: &str) -> Result<()> {
    sqlx::query(
        "UPDATE player_sessions
            SET ended_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
          WHERE ign = ? AND ended_at IS NULL",
    )
    .bind(ign)
    .execute(pool)
    .await?;
    sqlx::query("INSERT INTO player_sessions (ign) VALUES (?)")
        .bind(ign)
        .execute(pool)
        .await?;
    Ok(())
}

/// End the open session for `ign` (no-op if none is open).
pub async fn end(pool: &SqlitePool, ign: &str) -> Result<()> {
    sqlx::query(
        "UPDATE player_sessions
            SET ended_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
          WHERE ign = ? AND ended_at IS NULL",
    )
    .bind(ign)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Serialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct PlayerPlaytime {
    pub ign: String,
    /// Total minutes played in the window (open sessions counted to "now").
    pub minutes: i64,
    pub sessions: i64,
    pub last_seen: String,
}

#[derive(Debug, Serialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct HourBucket {
    pub hour: i64,     // 0–23, UTC
    pub sessions: i64,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ActivityInsights {
    pub days: i64,
    pub total_sessions: i64,
    pub players: Vec<PlayerPlaytime>,
    pub peak_hours: Vec<HourBucket>,
}

/// Aggregate insights over the last `days` days.
pub async fn insights(pool: &SqlitePool, days: i64) -> Result<ActivityInsights> {
    let days = days.clamp(1, 365);
    let since = format!("-{days} days");

    let players: Vec<PlayerPlaytime> = sqlx::query_as(
        "SELECT ign,
                CAST(SUM(
                    (julianday(COALESCE(ended_at, strftime('%Y-%m-%dT%H:%M:%SZ','now')))
                     - julianday(started_at)) * 1440.0
                ) AS INTEGER) AS minutes,
                COUNT(*) AS sessions,
                MAX(COALESCE(ended_at, started_at)) AS last_seen
           FROM player_sessions
          WHERE started_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now', ?)
          GROUP BY ign
          ORDER BY minutes DESC
          LIMIT 50",
    )
    .bind(&since)
    .fetch_all(pool)
    .await?;

    let peak_hours: Vec<HourBucket> = sqlx::query_as(
        "SELECT CAST(strftime('%H', started_at) AS INTEGER) AS hour,
                COUNT(*) AS sessions
           FROM player_sessions
          WHERE started_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now', ?)
          GROUP BY hour
          ORDER BY hour",
    )
    .bind(&since)
    .fetch_all(pool)
    .await?;

    let total_sessions: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM player_sessions
          WHERE started_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now', ?)",
    )
    .bind(&since)
    .fetch_one(pool)
    .await?;

    Ok(ActivityInsights { days, total_sessions, players, peak_hours })
}
