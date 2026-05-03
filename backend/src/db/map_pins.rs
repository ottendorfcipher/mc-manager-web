use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;
use crate::error::Result;

#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct MapPin {
    pub id:         i64,
    pub x:          f64,
    pub z:          f64,
    pub dimension:  String,
    pub label:      String,
    pub body:       Option<String>,
    pub icon:       String,
    /// "private" = author only; "team" = all authenticated users
    pub visibility: String,
    pub created_by: String,
    pub created_at: String,
    pub updated_at: String,
}

/// List pins visible to `actor_email`:
/// - all team-visible pins
/// - plus the actor's own private pins
pub async fn list(pool: &SqlitePool, actor_email: &str) -> Result<Vec<MapPin>> {
    Ok(sqlx::query_as::<_, MapPin>(
        "SELECT id, x, z, dimension, label, body, icon, visibility, created_by, created_at, updated_at
         FROM map_pins
         WHERE visibility = 'team' OR created_by = ?
         ORDER BY created_at DESC"
    )
    .bind(actor_email)
    .fetch_all(pool)
    .await?)
}

pub async fn get(pool: &SqlitePool, id: i64) -> Result<Option<MapPin>> {
    Ok(sqlx::query_as::<_, MapPin>(
        "SELECT id, x, z, dimension, label, body, icon, visibility, created_by, created_at, updated_at
         FROM map_pins WHERE id = ?"
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

pub async fn insert(
    pool:       &SqlitePool,
    x:          f64,
    z:          f64,
    dimension:  &str,
    label:      &str,
    body:       Option<&str>,
    icon:       &str,
    visibility: &str,
    created_by: &str,
) -> Result<i64> {
    let result = sqlx::query(
        "INSERT INTO map_pins (x, z, dimension, label, body, icon, visibility, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(x).bind(z)
    .bind(dimension)
    .bind(label)
    .bind(body)
    .bind(icon)
    .bind(visibility)
    .bind(created_by)
    .execute(pool)
    .await?;
    Ok(result.last_insert_rowid())
}

pub async fn update(
    pool:       &SqlitePool,
    id:         i64,
    label:      &str,
    body:       Option<&str>,
    icon:       &str,
    visibility: &str,
) -> Result<()> {
    sqlx::query(
        "UPDATE map_pins SET label=?, body=?, icon=?, visibility=?,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id=?"
    )
    .bind(label).bind(body).bind(icon).bind(visibility).bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("DELETE FROM map_pins WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}
