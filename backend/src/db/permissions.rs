use std::collections::HashSet;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

use crate::error::Result;

#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct Permission {
    pub key: String,
    pub category: String,
    pub description: String,
}

/// An additive per-user permission override grant.
#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct PermissionOverride {
    pub permission_key: String,
    pub granted_by: String,
    pub granted_at: String,
}

/// All permissions in the catalog, sorted by (category, key) for stable UI rendering.
pub async fn list_all(pool: &SqlitePool) -> Result<Vec<Permission>> {
    Ok(sqlx::query_as::<_, Permission>(
        "SELECT key, category, description FROM permissions ORDER BY category, key",
    )
    .fetch_all(pool)
    .await?)
}

/// Permission keys granted to `role`.
pub async fn for_role(pool: &SqlitePool, role: &str) -> Result<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT permission_key FROM role_permissions WHERE role = ? ORDER BY permission_key",
    )
    .bind(role)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(k,)| k).collect())
}

/// Replace the full permission set for `role` in a single transaction.
pub async fn set_for_role(pool: &SqlitePool, role: &str, keys: &[String]) -> Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM role_permissions WHERE role = ?")
        .bind(role)
        .execute(&mut *tx)
        .await?;
    for key in keys {
        sqlx::query("INSERT INTO role_permissions (role, permission_key) VALUES (?, ?)")
            .bind(role)
            .bind(key)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Effective permission set = role permissions UNION per-user overrides.
/// Overrides are additive only — they can grant extra permissions but
/// never revoke role permissions.
pub async fn effective_for(pool: &SqlitePool, email: &str, role: &str) -> Result<HashSet<String>> {
    let mut perms: HashSet<String> = for_role(pool, role).await?.into_iter().collect();

    // Layer on per-user overrides
    let overrides: Vec<(String,)> =
        sqlx::query_as("SELECT permission_key FROM user_permission_overrides WHERE email = ?")
            .bind(email)
            .fetch_all(pool)
            .await?;
    for (key,) in overrides {
        perms.insert(key);
    }
    Ok(perms)
}

// ── Per-user override CRUD ─────────────────────────────────────────────────────

pub async fn list_overrides(pool: &SqlitePool, email: &str) -> Result<Vec<PermissionOverride>> {
    Ok(sqlx::query_as::<_, PermissionOverride>(
        "SELECT permission_key, granted_by, granted_at
         FROM user_permission_overrides
         WHERE email = ?
         ORDER BY permission_key",
    )
    .bind(email)
    .fetch_all(pool)
    .await?)
}

/// Add an override, validating the key exists in the catalog first.
pub async fn add_override(
    pool: &SqlitePool,
    email: &str,
    key: &str,
    granted_by: &str,
) -> Result<()> {
    // Validate key is in the permission catalog — fail fast, clear message.
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM permissions WHERE key = ?")
        .bind(key)
        .fetch_one(pool)
        .await?;
    if exists == 0 {
        return Err(crate::error::AppError::BadRequest(format!(
            "Permission key '{key}' is not in the catalog"
        )));
    }
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    sqlx::query(
        "INSERT OR IGNORE INTO user_permission_overrides (email, permission_key, granted_by, granted_at)
         VALUES (?, ?, ?, ?)",
    )
    .bind(email)
    .bind(key)
    .bind(granted_by)
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_override(pool: &SqlitePool, email: &str, key: &str) -> Result<()> {
    sqlx::query("DELETE FROM user_permission_overrides WHERE email = ? AND permission_key = ?")
        .bind(email)
        .bind(key)
        .execute(pool)
        .await?;
    Ok(())
}
