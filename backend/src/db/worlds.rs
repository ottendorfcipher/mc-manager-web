use crate::error::Result;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct World {
    pub id:          i64,
    pub name:        String,
    /// Directory-safe identifier used as the folder name on mc-server-1.
    pub slug:        String,
    pub description: Option<String>,
    pub seed:        Option<String>,
    pub is_active:   bool,
    pub created_at:  String,
    pub created_by:  String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct WorldMember {
    pub world_id:   i64,
    pub user_email: String,
    pub added_at:   String,
}

// ── Worlds CRUD ───────────────────────────────────────────────────────────────

const SELECT: &str =
    "SELECT id, name, slug, description, seed, is_active, created_at, created_by FROM worlds";

pub async fn list(pool: &SqlitePool) -> Result<Vec<World>> {
    Ok(
        sqlx::query_as::<_, World>(&format!(
            "{SELECT} ORDER BY is_active DESC, created_at ASC"
        ))
        .fetch_all(pool)
        .await?,
    )
}

pub async fn get(pool: &SqlitePool, id: i64) -> Result<Option<World>> {
    Ok(
        sqlx::query_as::<_, World>(&format!("{SELECT} WHERE id = ?"))
            .bind(id)
            .fetch_optional(pool)
            .await?,
    )
}

pub async fn get_active(pool: &SqlitePool) -> Result<Option<World>> {
    Ok(
        sqlx::query_as::<_, World>(&format!("{SELECT} WHERE is_active = 1 LIMIT 1"))
            .fetch_optional(pool)
            .await?,
    )
}

pub async fn insert(
    pool: &SqlitePool,
    name: &str,
    slug: &str,
    description: Option<&str>,
    seed: Option<&str>,
    created_by: &str,
) -> Result<i64> {
    let result = sqlx::query(
        "INSERT INTO worlds (name, slug, description, seed, is_active, created_by)
         VALUES (?, ?, ?, ?, 0, ?)",
    )
    .bind(name)
    .bind(slug)
    .bind(description)
    .bind(seed)
    .bind(created_by)
    .execute(pool)
    .await?;
    Ok(result.last_insert_rowid())
}

/// Set `id` as the only active world (all others become inactive).
/// Wrapped in a transaction so the flag is always consistent.
pub async fn set_active(pool: &SqlitePool, id: i64) -> Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE worlds SET is_active = 0")
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE worlds SET is_active = 1 WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// Delete a non-active world. Silently does nothing if is_active = 1.
pub async fn remove(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("DELETE FROM worlds WHERE id = ? AND is_active = 0")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn slug_exists(pool: &SqlitePool, slug: &str) -> Result<bool> {
    let row: Option<(i64,)> =
        sqlx::query_as("SELECT id FROM worlds WHERE slug = ?")
            .bind(slug)
            .fetch_optional(pool)
            .await?;
    Ok(row.is_some())
}

// ── World members ─────────────────────────────────────────────────────────────

pub async fn list_members(pool: &SqlitePool, world_id: i64) -> Result<Vec<WorldMember>> {
    Ok(
        sqlx::query_as::<_, WorldMember>(
            "SELECT world_id, user_email, added_at
             FROM world_members WHERE world_id = ? ORDER BY added_at ASC",
        )
        .bind(world_id)
        .fetch_all(pool)
        .await?,
    )
}

/// Replace the entire member list for a world in a single transaction.
pub async fn set_members(
    pool: &SqlitePool,
    world_id: i64,
    emails: &[String],
) -> Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM world_members WHERE world_id = ?")
        .bind(world_id)
        .execute(&mut *tx)
        .await?;
    for email in emails {
        sqlx::query(
            "INSERT OR IGNORE INTO world_members (world_id, user_email) VALUES (?, ?)",
        )
        .bind(world_id)
        .bind(email)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}
