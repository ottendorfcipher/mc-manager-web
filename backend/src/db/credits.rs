use crate::error::Result;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ScrollingCredits {
    pub id: i64,
    pub name: String,
    pub lines_json: String,
    pub scroll_speed_ms: i64,
    pub freeze_player: i64,
    pub created_by: String,
    pub created_at: String,
}

/// A single line within a credits sequence (for JSON validation).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditLine {
    #[serde(rename = "type")]
    pub line_type: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
}

fn default_color() -> String {
    "white".into()
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

pub async fn create(
    pool: &SqlitePool,
    name: &str,
    lines_json: &str,
    scroll_speed_ms: i64,
    freeze_player: bool,
    created_by: &str,
) -> Result<ScrollingCredits> {
    Ok(sqlx::query_as::<_, ScrollingCredits>(
        "INSERT INTO scrolling_credits (name, lines_json, scroll_speed_ms, freeze_player, created_by)
         VALUES (?, ?, ?, ?, ?)
         RETURNING *",
    )
    .bind(name)
    .bind(lines_json)
    .bind(scroll_speed_ms)
    .bind(if freeze_player { 1_i64 } else { 0 })
    .bind(created_by)
    .fetch_one(pool)
    .await?)
}

pub async fn list(pool: &SqlitePool) -> Result<Vec<ScrollingCredits>> {
    Ok(sqlx::query_as::<_, ScrollingCredits>(
        "SELECT * FROM scrolling_credits ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn get(pool: &SqlitePool, id: i64) -> Result<Option<ScrollingCredits>> {
    Ok(sqlx::query_as::<_, ScrollingCredits>(
        "SELECT * FROM scrolling_credits WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

pub async fn update(
    pool: &SqlitePool,
    id: i64,
    name: &str,
    lines_json: &str,
    scroll_speed_ms: i64,
    freeze_player: bool,
) -> Result<bool> {
    let r = sqlx::query(
        "UPDATE scrolling_credits SET name = ?, lines_json = ?, scroll_speed_ms = ?, freeze_player = ?
         WHERE id = ?",
    )
    .bind(name)
    .bind(lines_json)
    .bind(scroll_speed_ms)
    .bind(if freeze_player { 1_i64 } else { 0 })
    .bind(id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn delete(pool: &SqlitePool, id: i64) -> Result<bool> {
    let r = sqlx::query("DELETE FROM scrolling_credits WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

/// Check whether any music zone references this credits sequence.
pub async fn is_referenced(pool: &SqlitePool, id: i64) -> Result<bool> {
    let row: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM music_zones WHERE credits_id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await?;
    Ok(row.0 > 0)
}
