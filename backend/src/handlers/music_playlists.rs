//! Music playlists + play history.
//!
//! Curated, named sets of tracks that can be queued in one action, plus a
//! recently-played log. Gated by `music.play` (anyone who can play music).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;

use crate::{
    auth::middleware::AuthUser,
    db::{music_queue, playlists},
    error::{AppError, Result},
    minecraft::music,
    state::AppState,
};

const PERM: &str = "music.play";

/// Resolve a sound's display name from the vanilla catalog or custom tracks.
async fn resolve_display_name(state: &AppState, sound_id: &str) -> Result<String> {
    if let Some(e) = music::lookup(sound_id) {
        return Ok(e.display_name.to_string());
    }
    let customs = music_queue::list_custom_tracks(&state.pool).await.unwrap_or_default();
    customs
        .iter()
        .find(|t| t.sound_id == sound_id)
        .map(|t| t.display_name.clone())
        .ok_or_else(|| AppError::BadRequest(format!("Unknown sound '{sound_id}'")))
}

// ── Playlists ──────────────────────────────────────────────────────────────────

pub async fn list(State(state): State<AppState>, actor: AuthUser) -> Result<Json<Vec<playlists::Playlist>>> {
    crate::auth::middleware::require_perm(&actor, PERM)?;
    Ok(Json(playlists::list(&state.pool).await?))
}

#[derive(Deserialize)]
pub struct CreateBody {
    pub name: String,
}

pub async fn create(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<CreateBody>,
) -> Result<(StatusCode, Json<serde_json::Value>)> {
    crate::auth::middleware::require_perm(&actor, PERM)?;
    crate::validation::validate_text(&body.name, "name", 80)?;
    let id = playlists::create(&state.pool, body.name.trim(), &actor.email).await?;
    Ok((StatusCode::CREATED, Json(serde_json::json!({ "id": id }))))
}

pub async fn delete(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, PERM)?;
    playlists::delete(&state.pool, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn detail(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<Json<playlists::PlaylistDetail>> {
    crate::auth::middleware::require_perm(&actor, PERM)?;
    let tracks = playlists::tracks(&state.pool, id).await?;
    Ok(Json(playlists::PlaylistDetail { id, name: String::new(), tracks }))
}

#[derive(Deserialize)]
pub struct AddTrackBody {
    pub sound_id: String,
}

pub async fn add_track(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
    Json(body): Json<AddTrackBody>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, PERM)?;
    let dn = resolve_display_name(&state, &body.sound_id).await?;
    playlists::add_track(&state.pool, id, &body.sound_id, &dn).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_track(
    State(state): State<AppState>,
    actor: AuthUser,
    Path((id, sound_id)): Path<(i64, String)>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, PERM)?;
    playlists::remove_track(&state.pool, id, &sound_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Queue every track in the playlist (in order). Starts playback if idle.
pub async fn queue(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, PERM)?;
    let tracks = playlists::tracks(&state.pool, id).await?;
    if tracks.is_empty() {
        return Err(AppError::BadRequest("Playlist is empty".into()));
    }
    for t in &tracks {
        music_queue::enqueue(&state.pool, &t.sound_id, &t.display_name, &actor.email).await?;
    }
    // If nothing is playing, kick off the first queued track.
    let idle = state.music_current.lock().await.is_none();
    if idle {
        music::start_next(&state.config, &state.pool, &state.music_current, &state.music_tx).await;
    }
    music::broadcast_state(&state.pool, &state.music_current, &state.music_tx).await;
    Ok(StatusCode::NO_CONTENT)
}

// ── Play history ───────────────────────────────────────────────────────────────

pub async fn history(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<Vec<playlists::PlayHistoryEntry>>> {
    crate::auth::middleware::require_perm(&actor, PERM)?;
    Ok(Json(playlists::history(&state.pool, 30).await?))
}
