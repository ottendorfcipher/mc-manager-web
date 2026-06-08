//! Music playlists + play history.

use crate::error::Result;
use serde::Serialize;
use sqlx::SqlitePool;
use ts_rs::TS;

#[derive(Debug, Serialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct Playlist {
    pub id:          i64,
    pub name:        String,
    pub created_by:  String,
    pub created_at:  String,
    pub track_count: i64,
}

#[derive(Debug, Serialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct PlaylistTrack {
    pub sound_id:     String,
    pub display_name: String,
    pub position:     i64,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct PlaylistDetail {
    pub id:     i64,
    pub name:   String,
    pub tracks: Vec<PlaylistTrack>,
}

// ── Playlists ──────────────────────────────────────────────────────────────────

pub async fn list(pool: &SqlitePool) -> Result<Vec<Playlist>> {
    Ok(sqlx::query_as::<_, Playlist>(
        "SELECT p.id, p.name, p.created_by, p.created_at,
                (SELECT COUNT(*) FROM playlist_tracks t WHERE t.playlist_id = p.id) AS track_count
           FROM playlists p ORDER BY p.name",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn create(pool: &SqlitePool, name: &str, by: &str) -> Result<i64> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO playlists (name, created_by) VALUES (?, ?) RETURNING id",
    )
    .bind(name)
    .bind(by)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn delete(pool: &SqlitePool, id: i64) -> Result<()> {
    sqlx::query("DELETE FROM playlists WHERE id = ?").bind(id).execute(pool).await?;
    Ok(())
}

pub async fn tracks(pool: &SqlitePool, playlist_id: i64) -> Result<Vec<PlaylistTrack>> {
    Ok(sqlx::query_as::<_, PlaylistTrack>(
        "SELECT sound_id, display_name, position FROM playlist_tracks
          WHERE playlist_id = ? ORDER BY position, display_name",
    )
    .bind(playlist_id)
    .fetch_all(pool)
    .await?)
}

pub async fn add_track(
    pool: &SqlitePool,
    playlist_id: i64,
    sound_id: &str,
    display_name: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO playlist_tracks (playlist_id, sound_id, display_name, position)
         VALUES (?, ?, ?, COALESCE((SELECT MAX(position) + 1 FROM playlist_tracks WHERE playlist_id = ?), 0))
         ON CONFLICT(playlist_id, sound_id) DO UPDATE SET display_name = excluded.display_name",
    )
    .bind(playlist_id)
    .bind(sound_id)
    .bind(display_name)
    .bind(playlist_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_track(pool: &SqlitePool, playlist_id: i64, sound_id: &str) -> Result<()> {
    sqlx::query("DELETE FROM playlist_tracks WHERE playlist_id = ? AND sound_id = ?")
        .bind(playlist_id)
        .bind(sound_id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Play history ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct PlayHistoryEntry {
    pub id:           i64,
    pub sound_id:     String,
    pub display_name: String,
    pub played_at:    String,
}

pub async fn record_play(pool: &SqlitePool, sound_id: &str, display_name: &str) {
    if let Err(e) = sqlx::query("INSERT INTO play_history (sound_id, display_name) VALUES (?, ?)")
        .bind(sound_id)
        .bind(display_name)
        .execute(pool)
        .await
    {
        tracing::warn!(error = %e, "play_history: record failed");
    }
}

pub async fn history(pool: &SqlitePool, limit: i64) -> Result<Vec<PlayHistoryEntry>> {
    Ok(sqlx::query_as::<_, PlayHistoryEntry>(
        "SELECT id, sound_id, display_name, played_at
           FROM play_history ORDER BY played_at DESC, id DESC LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?)
}
