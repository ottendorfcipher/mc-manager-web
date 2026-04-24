use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

use crate::error::Result;

#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct Permission {
    pub key:         String,
    pub category:    String,
    pub description: String,
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
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT permission_key FROM role_permissions WHERE role = ? ORDER BY permission_key")
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

/// Effective permission set for a user. Today this is role-only; per-user
/// overrides can be layered on in a later migration without changing callers.
pub async fn effective_for(pool: &SqlitePool, _email: &str, role: &str) -> Result<HashSet<String>> {
    Ok(for_role(pool, role).await?.into_iter().collect())
}
