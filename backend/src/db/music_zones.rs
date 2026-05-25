use crate::error::Result;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

// ── Zone row ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct MusicZone {
    pub id:                  i64,
    pub name:                String,
    pub dimension:           String,
    pub x1:                  i64,
    pub y1:                  i64,
    pub z1:                  i64,
    pub x2:                  i64,
    pub y2:                  i64,
    pub z2:                  i64,
    /// JSON-encoded array of sound IDs.
    pub sound_ids_json:      String,
    /// JSON-encoded array of IGNs, or NULL for "everyone".
    pub target_players_json: Option<String>,
    pub stop_on_leave:       i64,
    pub cooldown_secs:       i64,
    pub enabled:             i64,
    pub created_by:          String,
    pub created_at:          String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ZonePlayerState {
    pub zone_id:     i64,
    pub player_ign:  String,
    pub in_zone:     i64,
    pub is_playing:  i64,
    pub sound_index: i64,
    pub started_at:  Option<String>,
    pub finished_at: Option<String>,
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub async fn create(
    pool:                &SqlitePool,
    name:                &str,
    dimension:           &str,
    x1: i64, y1: i64, z1: i64,
    x2: i64, y2: i64, z2: i64,
    sound_ids_json:      &str,
    target_players_json: Option<&str>,
    stop_on_leave:       bool,
    cooldown_secs:       i64,
    created_by:          &str,
) -> Result<MusicZone> {
    Ok(sqlx::query_as::<_, MusicZone>(
        "INSERT INTO music_zones
            (name, dimension, x1, y1, z1, x2, y2, z2,
             sound_ids_json, target_players_json, stop_on_leave, cooldown_secs, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *",
    )
    .bind(name)
    .bind(dimension)
    .bind(x1).bind(y1).bind(z1)
    .bind(x2).bind(y2).bind(z2)
    .bind(sound_ids_json)
    .bind(target_players_json)
    .bind(if stop_on_leave { 1_i64 } else { 0_i64 })
    .bind(cooldown_secs)
    .bind(created_by)
    .fetch_one(pool)
    .await?)
}

pub async fn list(pool: &SqlitePool) -> Result<Vec<MusicZone>> {
    Ok(sqlx::query_as::<_, MusicZone>(
        "SELECT * FROM music_zones ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn list_enabled(pool: &SqlitePool) -> Result<Vec<MusicZone>> {
    Ok(sqlx::query_as::<_, MusicZone>(
        "SELECT * FROM music_zones WHERE enabled = 1 ORDER BY id ASC",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn get(pool: &SqlitePool, id: i64) -> Result<Option<MusicZone>> {
    Ok(sqlx::query_as::<_, MusicZone>("SELECT * FROM music_zones WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?)
}

#[allow(clippy::too_many_arguments)]
pub async fn update(
    pool:                &SqlitePool,
    id:                  i64,
    name:                &str,
    dimension:           &str,
    x1: i64, y1: i64, z1: i64,
    x2: i64, y2: i64, z2: i64,
    sound_ids_json:      &str,
    target_players_json: Option<&str>,
    stop_on_leave:       bool,
    cooldown_secs:       i64,
    enabled:             bool,
) -> Result<bool> {
    let r = sqlx::query(
        "UPDATE music_zones SET
            name = ?, dimension = ?,
            x1 = ?, y1 = ?, z1 = ?,
            x2 = ?, y2 = ?, z2 = ?,
            sound_ids_json = ?, target_players_json = ?,
            stop_on_leave = ?, cooldown_secs = ?, enabled = ?
          WHERE id = ?",
    )
    .bind(name)
    .bind(dimension)
    .bind(x1).bind(y1).bind(z1)
    .bind(x2).bind(y2).bind(z2)
    .bind(sound_ids_json)
    .bind(target_players_json)
    .bind(if stop_on_leave { 1_i64 } else { 0_i64 })
    .bind(cooldown_secs)
    .bind(if enabled { 1_i64 } else { 0_i64 })
    .bind(id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn delete(pool: &SqlitePool, id: i64) -> Result<bool> {
    let r = sqlx::query("DELETE FROM music_zones WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

// ── Per-player state ─────────────────────────────────────────────────────────

pub async fn get_state(
    pool: &SqlitePool,
    zone_id: i64,
    ign: &str,
) -> Result<Option<ZonePlayerState>> {
    Ok(sqlx::query_as::<_, ZonePlayerState>(
        "SELECT * FROM music_zone_player_state WHERE zone_id = ? AND player_ign = ?",
    )
    .bind(zone_id)
    .bind(ign)
    .fetch_optional(pool)
    .await?)
}

/// Insert or update a single per-player state row.
#[allow(clippy::too_many_arguments)]
pub async fn upsert_state(
    pool:        &SqlitePool,
    zone_id:     i64,
    ign:         &str,
    in_zone:     bool,
    is_playing:  bool,
    sound_index: i64,
    started_at:  Option<&str>,
    finished_at: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO music_zone_player_state
            (zone_id, player_ign, in_zone, is_playing, sound_index, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(zone_id, player_ign) DO UPDATE SET
            in_zone     = excluded.in_zone,
            is_playing  = excluded.is_playing,
            sound_index = excluded.sound_index,
            started_at  = COALESCE(excluded.started_at,  music_zone_player_state.started_at),
            finished_at = COALESCE(excluded.finished_at, music_zone_player_state.finished_at)",
    )
    .bind(zone_id)
    .bind(ign)
    .bind(if in_zone { 1_i64 } else { 0_i64 })
    .bind(if is_playing { 1_i64 } else { 0_i64 })
    .bind(sound_index)
    .bind(started_at)
    .bind(finished_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// Mark a player as no-longer-playing this zone's track.
pub async fn mark_finished(
    pool:        &SqlitePool,
    zone_id:     i64,
    ign:         &str,
    finished_at: &str,
) -> Result<()> {
    sqlx::query(
        "UPDATE music_zone_player_state
            SET is_playing = 0, finished_at = ?
          WHERE zone_id = ? AND player_ign = ?",
    )
    .bind(finished_at)
    .bind(zone_id)
    .bind(ign)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn set_in_zone(
    pool: &SqlitePool,
    zone_id: i64,
    ign: &str,
    in_zone: bool,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO music_zone_player_state (zone_id, player_ign, in_zone)
         VALUES (?, ?, ?)
         ON CONFLICT(zone_id, player_ign) DO UPDATE SET in_zone = excluded.in_zone",
    )
    .bind(zone_id)
    .bind(ign)
    .bind(if in_zone { 1_i64 } else { 0_i64 })
    .execute(pool)
    .await?;
    Ok(())
}
