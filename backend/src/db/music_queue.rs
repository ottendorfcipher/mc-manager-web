use crate::error::Result;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

// ── DB row ─────────────────────────────────────────────────────────────────────

/// A single entry in the persistent music queue (upcoming tracks only).
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct QueueEntry {
    pub id:           i64,
    pub sound_id:     String,
    pub display_name: String,
    pub requested_by: String,
    pub queued_at:    String,
}

// ── API / SSE payload types ────────────────────────────────────────────────────
// These are the serialised shapes sent to the frontend via GET /music/state
// and the SSE stream.  NowPlayingPayload is computed from the ephemeral
// in-memory CurrentTrack (which holds a std::time::Instant and cannot itself
// be serialised).

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NowPlayingPayload {
    pub queue_id:      i64,
    pub sound_id:      String,
    pub display_name:  String,
    pub artist:        String,
    pub requested_by:  String,
    /// Seconds elapsed since the track started (approximate).
    pub elapsed_secs:  u64,
    pub duration_secs: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicStatePayload {
    pub now_playing: Option<NowPlayingPayload>,
    pub queue:       Vec<QueueEntry>,
}

// ── DB operations ──────────────────────────────────────────────────────────────

/// Insert a new entry at the back of the queue.
pub async fn enqueue(
    pool:         &SqlitePool,
    sound_id:     &str,
    display_name: &str,
    requested_by: &str,
) -> Result<QueueEntry> {
    Ok(sqlx::query_as::<_, QueueEntry>(
        "INSERT INTO music_queue (sound_id, display_name, requested_by)
         VALUES (?, ?, ?)
         RETURNING *",
    )
    .bind(sound_id)
    .bind(display_name)
    .bind(requested_by)
    .fetch_one(pool)
    .await?)
}

/// Return all queued entries in FIFO order (lowest id first).
pub async fn list(pool: &SqlitePool) -> Result<Vec<QueueEntry>> {
    Ok(
        sqlx::query_as::<_, QueueEntry>("SELECT * FROM music_queue ORDER BY id ASC")
            .fetch_all(pool)
            .await?,
    )
}

/// Atomically pop and return the front entry (lowest id).
/// Returns `None` if the queue is empty.
pub async fn pop_front(pool: &SqlitePool) -> Result<Option<QueueEntry>> {
    Ok(sqlx::query_as::<_, QueueEntry>(
        "DELETE FROM music_queue
         WHERE id = (SELECT MIN(id) FROM music_queue)
         RETURNING *",
    )
    .fetch_optional(pool)
    .await?)
}

/// Remove a specific entry by id.  Returns `true` if a row was deleted.
pub async fn remove(pool: &SqlitePool, id: i64) -> Result<bool> {
    let r = sqlx::query("DELETE FROM music_queue WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

/// Remove all queued entries (used by the stop-all command).
pub async fn clear(pool: &SqlitePool) -> Result<()> {
    sqlx::query("DELETE FROM music_queue")
        .execute(pool)
        .await?;
    Ok(())
}
