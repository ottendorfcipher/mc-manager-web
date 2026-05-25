//! REST CRUD for music zones — region-triggered per-player music playback.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;

use crate::{
    auth::middleware::AuthUser,
    db::music_zones,
    error::{AppError, Result},
    state::AppState,
};

// ── GET /api/music/zones ──────────────────────────────────────────────────────

pub async fn list(
    State(state): State<AppState>,
    actor:        AuthUser,
) -> Result<Json<Vec<music_zones::MusicZone>>> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;
    Ok(Json(music_zones::list(&state.pool).await?))
}

// ── POST /api/music/zones ─────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateBody {
    pub name:           String,
    #[serde(default = "default_dimension")]
    pub dimension:      String,
    pub x1:             i64,
    pub y1:             i64,
    pub z1:             i64,
    pub x2:             i64,
    pub y2:             i64,
    pub z2:             i64,
    /// 1+ sound IDs.  Plays in sequence (first one starts immediately).
    pub sound_ids:      Vec<String>,
    /// Optional player whitelist.  If empty/missing, the zone fires for everyone.
    #[serde(default)]
    pub target_players: Option<Vec<String>>,
    #[serde(default)]
    pub stop_on_leave:  bool,
    #[serde(default = "default_cooldown")]
    pub cooldown_secs:  i64,
}

fn default_dimension() -> String { "minecraft:overworld".into() }
fn default_cooldown()  -> i64    { 1800 }

fn validate(body: &CreateBody) -> Result<()> {
    let name = body.name.trim();
    if name.is_empty() || name.len() > 60 {
        return Err(AppError::BadRequest("Name must be 1–60 characters".into()));
    }
    if body.sound_ids.is_empty() {
        return Err(AppError::BadRequest("At least one sound is required".into()));
    }
    if body.cooldown_secs < 0 || body.cooldown_secs > 86_400 {
        return Err(AppError::BadRequest("cooldown_secs must be 0–86400".into()));
    }
    Ok(())
}

pub async fn create(
    State(state): State<AppState>,
    actor:        AuthUser,
    Json(body):   Json<CreateBody>,
) -> Result<(StatusCode, Json<music_zones::MusicZone>)> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;
    validate(&body)?;

    let sound_ids_json = serde_json::to_string(&body.sound_ids)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("serialize sound_ids: {e}")))?;
    let target_players_json = body.target_players
        .as_ref()
        .filter(|v| !v.is_empty())
        .map(|v| serde_json::to_string(v).ok())
        .flatten();

    let row = music_zones::create(
        &state.pool,
        body.name.trim(),
        &body.dimension,
        body.x1, body.y1, body.z1,
        body.x2, body.y2, body.z2,
        &sound_ids_json,
        target_players_json.as_deref(),
        body.stop_on_leave,
        body.cooldown_secs,
        &actor.email,
    )
    .await?;

    Ok((StatusCode::CREATED, Json(row)))
}

// ── PATCH /api/music/zones/:id ────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct UpdateBody {
    pub name:           String,
    pub dimension:      String,
    pub x1:             i64,
    pub y1:             i64,
    pub z1:             i64,
    pub x2:             i64,
    pub y2:             i64,
    pub z2:             i64,
    pub sound_ids:      Vec<String>,
    pub target_players: Option<Vec<String>>,
    pub stop_on_leave:  bool,
    pub cooldown_secs:  i64,
    pub enabled:        bool,
}

pub async fn update(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(id):     Path<i64>,
    Json(body):   Json<UpdateBody>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;

    // Reuse create-validation by transferring into CreateBody
    let cb = CreateBody {
        name:           body.name.clone(),
        dimension:      body.dimension.clone(),
        x1: body.x1, y1: body.y1, z1: body.z1,
        x2: body.x2, y2: body.y2, z2: body.z2,
        sound_ids:      body.sound_ids.clone(),
        target_players: body.target_players.clone(),
        stop_on_leave:  body.stop_on_leave,
        cooldown_secs:  body.cooldown_secs,
    };
    validate(&cb)?;

    let sound_ids_json = serde_json::to_string(&body.sound_ids)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("serialize sound_ids: {e}")))?;
    let target_players_json = body.target_players
        .as_ref()
        .filter(|v| !v.is_empty())
        .map(|v| serde_json::to_string(v).ok())
        .flatten();

    let ok = music_zones::update(
        &state.pool,
        id,
        body.name.trim(),
        &body.dimension,
        body.x1, body.y1, body.z1,
        body.x2, body.y2, body.z2,
        &sound_ids_json,
        target_players_json.as_deref(),
        body.stop_on_leave,
        body.cooldown_secs,
        body.enabled,
    )
    .await?;
    if !ok {
        return Err(AppError::NotFound(format!("Music zone {id} not found")));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ── DELETE /api/music/zones/:id ───────────────────────────────────────────────

pub async fn delete(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(id):     Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;
    let ok = music_zones::delete(&state.pool, id).await?;
    if !ok {
        return Err(AppError::NotFound(format!("Music zone {id} not found")));
    }
    Ok(StatusCode::NO_CONTENT)
}
