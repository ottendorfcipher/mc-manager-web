//! One-time sign-in link tokens for in-game QR code SSO.

use crate::error::Result;
use sqlx::SqlitePool;

pub struct LinkToken {
    pub token:      String,
    pub email:      String,
    pub ign:        String,
    pub expires_at: String,
    pub used:       bool,
}

/// Create a new link token. Returns the token string.
pub async fn create(
    pool:       &SqlitePool,
    token:      &str,
    email:      &str,
    ign:        &str,
    expires_at: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO link_tokens (token, email, ign, expires_at) VALUES (?, ?, ?, ?)",
    )
    .bind(token)
    .bind(email)
    .bind(ign)
    .bind(expires_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// Look up a token. Returns None if not found.
pub async fn get(pool: &SqlitePool, token: &str) -> Result<Option<LinkToken>> {
    let row = sqlx::query_as::<_, (String, String, String, String, i64)>(
        "SELECT token, email, ign, expires_at, used FROM link_tokens WHERE token = ?",
    )
    .bind(token)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(token, email, ign, expires_at, used)| LinkToken {
        token,
        email,
        ign,
        expires_at,
        used: used != 0,
    }))
}

/// Mark a token as used so it can't be reused.
pub async fn mark_used(pool: &SqlitePool, token: &str) -> Result<()> {
    sqlx::query("UPDATE link_tokens SET used = 1 WHERE token = ?")
        .bind(token)
        .execute(pool)
        .await?;
    Ok(())
}

/// Delete expired tokens (housekeeping).
pub async fn cleanup_expired(pool: &SqlitePool) -> Result<u64> {
    let r = sqlx::query("DELETE FROM link_tokens WHERE expires_at < datetime('now')")
        .execute(pool)
        .await?;
    Ok(r.rows_affected())
}
