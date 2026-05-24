use crate::error::Result;
use serde::Serialize;
use sqlx::SqlitePool;

// ── DB row ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Countdown {
    pub id:            i64,
    pub title:         String,
    pub duration_secs: i64,
    pub target:        String,
    pub display_mode:  String,
    pub color:         String,
    pub sound_id:      Option<String>,
    pub status:        String,
    pub elapsed_secs:  i64,
    pub created_by:    String,
    pub created_at:    String,
    pub started_at:    Option<String>,
    pub finished_at:   Option<String>,
}

// ── SSE / API payload types ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct CountdownStatePayload {
    pub active: Option<ActiveCountdownPayload>,
    pub recent: Vec<Countdown>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ActiveCountdownPayload {
    pub id:             i64,
    pub title:          String,
    pub duration_secs:  i64,
    pub remaining_secs: i64,
    pub target:         String,
    pub display_mode:   String,
    pub color:          String,
    pub sound_id:       Option<String>,
    pub status:         String,
    pub created_by:     String,
}

// ── DB operations ──────────────────────────────────────────────────────────────

pub async fn create(
    pool:         &SqlitePool,
    title:        &str,
    duration_secs: i64,
    target:       &str,
    display_mode: &str,
    color:        &str,
    sound_id:     Option<&str>,
    created_by:   &str,
) -> Result<Countdown> {
    Ok(sqlx::query_as::<_, Countdown>(
        "INSERT INTO countdowns (title, duration_secs, target, display_mode, color, sound_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING *",
    )
    .bind(title)
    .bind(duration_secs)
    .bind(target)
    .bind(display_mode)
    .bind(color)
    .bind(sound_id)
    .bind(created_by)
    .fetch_one(pool)
    .await?)
}

pub async fn get(pool: &SqlitePool, id: i64) -> Result<Option<Countdown>> {
    Ok(sqlx::query_as::<_, Countdown>("SELECT * FROM countdowns WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?)
}

pub async fn list_recent(pool: &SqlitePool, limit: i64) -> Result<Vec<Countdown>> {
    Ok(sqlx::query_as::<_, Countdown>(
        "SELECT * FROM countdowns ORDER BY created_at DESC LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?)
}

pub async fn update_status(
    pool:         &SqlitePool,
    id:           i64,
    status:       &str,
    elapsed_secs: i64,
) -> Result<bool> {
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let r = match status {
        "running" => {
            sqlx::query(
                "UPDATE countdowns SET status = ?, elapsed_secs = ?, started_at = COALESCE(started_at, ?) WHERE id = ?",
            )
            .bind(status)
            .bind(elapsed_secs)
            .bind(&now)
            .bind(id)
            .execute(pool)
            .await?
        }
        "finished" | "cancelled" => {
            sqlx::query(
                "UPDATE countdowns SET status = ?, elapsed_secs = ?, finished_at = ? WHERE id = ?",
            )
            .bind(status)
            .bind(elapsed_secs)
            .bind(&now)
            .bind(id)
            .execute(pool)
            .await?
        }
        _ => {
            sqlx::query("UPDATE countdowns SET status = ?, elapsed_secs = ? WHERE id = ?")
                .bind(status)
                .bind(elapsed_secs)
                .bind(id)
                .execute(pool)
                .await?
        }
    };
    Ok(r.rows_affected() > 0)
}

pub async fn delete(pool: &SqlitePool, id: i64) -> Result<bool> {
    let r = sqlx::query(
        "DELETE FROM countdowns WHERE id = ? AND status IN ('pending', 'finished', 'cancelled')",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}
