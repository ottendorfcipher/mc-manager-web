//! Login history (one row per successful OAuth sign-in) + the global
//! "sign out everywhere" revocation timestamp on the users table.

use crate::error::Result;
use serde::Serialize;
use sqlx::SqlitePool;
use ts_rs::TS;

#[derive(Debug, Serialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct LoginEvent {
    pub id:         i64,
    pub ip:         Option<String>,
    pub user_agent: Option<String>,
    pub created_at: String,
}

/// Record a successful sign-in.
pub async fn record(
    pool: &SqlitePool,
    email: &str,
    ip: Option<&str>,
    user_agent: Option<&str>,
) -> Result<()> {
    sqlx::query("INSERT INTO login_events (email, ip, user_agent) VALUES (?, ?, ?)")
        .bind(email)
        .bind(ip)
        .bind(user_agent)
        .execute(pool)
        .await?;
    Ok(())
}

/// Recent sign-ins for a user, newest first.
pub async fn list(pool: &SqlitePool, email: &str, limit: i64) -> Result<Vec<LoginEvent>> {
    Ok(sqlx::query_as::<_, LoginEvent>(
        "SELECT id, ip, user_agent, created_at
           FROM login_events WHERE email = ?
          ORDER BY created_at DESC, id DESC LIMIT ?",
    )
    .bind(email)
    .bind(limit)
    .fetch_all(pool)
    .await?)
}

/// Read a user's revocation cutoff (epoch seconds; 0 = none).
pub async fn tokens_valid_after(pool: &SqlitePool, email: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(tokens_valid_after, 0) FROM users WHERE email = ?",
    )
    .bind(email)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or(0)
}

/// Invalidate all of a user's existing tokens (sign out everywhere). The cutoff
/// is `now + 1` so that every token issued up to and including the current
/// second (JWT `iat` has 1-second granularity) is rejected; the user re-logs in
/// afterward to get a fresh token.
pub async fn revoke_all(pool: &SqlitePool, email: &str) -> Result<()> {
    let cutoff = chrono::Utc::now().timestamp() + 1;
    sqlx::query("UPDATE users SET tokens_valid_after = ? WHERE email = ?")
        .bind(cutoff)
        .bind(email)
        .execute(pool)
        .await?;
    Ok(())
}
