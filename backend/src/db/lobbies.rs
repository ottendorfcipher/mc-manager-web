//! Pre-game lobby data access.
//!
//! Lobbies are linked to an event (countdown, rising oceans, bounty board,
//! or "manual" for ad-hoc admin-launched events).  Attendees are tracked
//! per-lobby with their pre-event coordinates so they can be returned home
//! when the event ends.

use crate::error::Result;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

// ── Row types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PreGameLobby {
    pub id:                   i64,
    pub name:                 String,
    pub lobby_x:              i64,
    pub lobby_y:              i64,
    pub lobby_z:              i64,
    pub radius:               i64,
    pub max_players:          i64,
    pub allowed_players_json: Option<String>,
    pub linked_event_type:    String,
    pub linked_event_id:      Option<i64>,
    pub launch_dimension:     String,
    pub launch_x:             i64,
    pub launch_y:             i64,
    pub launch_z:             i64,
    pub status:               String,
    pub created_by:           String,
    pub created_at:           String,
    pub launched_at:          Option<String>,
    pub closed_at:            Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct LobbyAttendee {
    pub lobby_id:            i64,
    pub player_ign:          String,
    pub joined_at:           String,
    pub pre_event_dimension: Option<String>,
    pub pre_event_x:         Option<f64>,
    pub pre_event_y:         Option<f64>,
    pub pre_event_z:         Option<f64>,
    pub status:              String,
}

// ── Lobby CRUD ───────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub async fn create(
    pool:                 &SqlitePool,
    name:                 &str,
    lobby_x:              i64,
    lobby_y:              i64,
    lobby_z:              i64,
    radius:               i64,
    max_players:          i64,
    allowed_players_json: Option<&str>,
    linked_event_type:    &str,
    linked_event_id:      Option<i64>,
    launch_dimension:     &str,
    launch_x:             i64,
    launch_y:             i64,
    launch_z:             i64,
    created_by:           &str,
) -> Result<PreGameLobby> {
    Ok(sqlx::query_as::<_, PreGameLobby>(
        "INSERT INTO pre_game_lobbies
            (name, lobby_x, lobby_y, lobby_z, radius, max_players,
             allowed_players_json, linked_event_type, linked_event_id,
             launch_dimension, launch_x, launch_y, launch_z, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *",
    )
    .bind(name)
    .bind(lobby_x).bind(lobby_y).bind(lobby_z)
    .bind(radius).bind(max_players)
    .bind(allowed_players_json)
    .bind(linked_event_type).bind(linked_event_id)
    .bind(launch_dimension).bind(launch_x).bind(launch_y).bind(launch_z)
    .bind(created_by)
    .fetch_one(pool)
    .await?)
}

pub async fn list(pool: &SqlitePool) -> Result<Vec<PreGameLobby>> {
    Ok(sqlx::query_as::<_, PreGameLobby>(
        "SELECT * FROM pre_game_lobbies ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn list_active(pool: &SqlitePool) -> Result<Vec<PreGameLobby>> {
    Ok(sqlx::query_as::<_, PreGameLobby>(
        "SELECT * FROM pre_game_lobbies
          WHERE status IN ('open', 'locked', 'launching', 'launched')
          ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn get(pool: &SqlitePool, id: i64) -> Result<Option<PreGameLobby>> {
    Ok(sqlx::query_as::<_, PreGameLobby>(
        "SELECT * FROM pre_game_lobbies WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

pub async fn update_status(pool: &SqlitePool, id: i64, status: &str) -> Result<bool> {
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let r = match status {
        "launched" | "launching" => {
            sqlx::query(
                "UPDATE pre_game_lobbies SET status = ?, launched_at = COALESCE(launched_at, ?) WHERE id = ?",
            )
            .bind(status).bind(&now).bind(id)
            .execute(pool).await?
        }
        "closed" => {
            sqlx::query(
                "UPDATE pre_game_lobbies SET status = ?, closed_at = ? WHERE id = ?",
            )
            .bind(status).bind(&now).bind(id)
            .execute(pool).await?
        }
        _ => {
            sqlx::query("UPDATE pre_game_lobbies SET status = ? WHERE id = ?")
                .bind(status).bind(id)
                .execute(pool).await?
        }
    };
    Ok(r.rows_affected() > 0)
}

pub async fn delete(pool: &SqlitePool, id: i64) -> Result<bool> {
    let r = sqlx::query("DELETE FROM pre_game_lobbies WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

// ── Attendee operations ──────────────────────────────────────────────────────

pub async fn list_attendees(pool: &SqlitePool, lobby_id: i64) -> Result<Vec<LobbyAttendee>> {
    Ok(sqlx::query_as::<_, LobbyAttendee>(
        "SELECT * FROM lobby_attendees WHERE lobby_id = ? ORDER BY joined_at ASC",
    )
    .bind(lobby_id)
    .fetch_all(pool)
    .await?)
}

pub async fn count_active_attendees(pool: &SqlitePool, lobby_id: i64) -> Result<i64> {
    Ok(sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM lobby_attendees WHERE lobby_id = ? AND status IN ('joined','launched')",
    )
    .bind(lobby_id)
    .fetch_one(pool)
    .await?)
}

#[allow(clippy::too_many_arguments)]
pub async fn add_attendee(
    pool:                &SqlitePool,
    lobby_id:            i64,
    ign:                 &str,
    pre_event_dimension: Option<&str>,
    pre_event_x:         Option<f64>,
    pre_event_y:         Option<f64>,
    pre_event_z:         Option<f64>,
) -> Result<LobbyAttendee> {
    Ok(sqlx::query_as::<_, LobbyAttendee>(
        "INSERT INTO lobby_attendees
            (lobby_id, player_ign, pre_event_dimension, pre_event_x, pre_event_y, pre_event_z)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(lobby_id, player_ign) DO UPDATE SET
            pre_event_dimension = excluded.pre_event_dimension,
            pre_event_x         = excluded.pre_event_x,
            pre_event_y         = excluded.pre_event_y,
            pre_event_z         = excluded.pre_event_z,
            status              = 'joined',
            joined_at           = CURRENT_TIMESTAMP
         RETURNING *",
    )
    .bind(lobby_id)
    .bind(ign)
    .bind(pre_event_dimension)
    .bind(pre_event_x).bind(pre_event_y).bind(pre_event_z)
    .fetch_one(pool)
    .await?)
}

pub async fn remove_attendee(pool: &SqlitePool, lobby_id: i64, ign: &str) -> Result<bool> {
    let r = sqlx::query("DELETE FROM lobby_attendees WHERE lobby_id = ? AND player_ign = ?")
        .bind(lobby_id).bind(ign)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn mark_attendees_status(
    pool: &SqlitePool,
    lobby_id: i64,
    status: &str,
) -> Result<u64> {
    let r = sqlx::query("UPDATE lobby_attendees SET status = ? WHERE lobby_id = ?")
        .bind(status).bind(lobby_id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected())
}
