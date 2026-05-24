//! REST handlers for pre-game lobbies.
//!
//! Endpoints under `/api/events/lobbies`:
//!   GET    /lobbies                — list
//!   POST   /lobbies                — create
//!   DELETE /lobbies/:id            — delete (closed/pending only)
//!   POST   /lobbies/:id/join       — TP a player into the lobby
//!   POST   /lobbies/:id/leave      — TP a player back out (admin or self)
//!   POST   /lobbies/:id/launch     — bossbar countdown + fade + bulk TP
//!   POST   /lobbies/:id/close      — return everyone to pre-event coords

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;

use crate::{
    auth::middleware::AuthUser,
    db::{lobbies, player_snapshots},
    error::{AppError, Result},
    minecraft::lobby_runner,
    state::AppState,
};

// ── GET /api/events/lobbies ───────────────────────────────────────────────────

/// Lobby payload with attendees attached so the UI can render in one call.
#[derive(serde::Serialize)]
pub struct LobbyWithAttendees {
    #[serde(flatten)]
    pub lobby:     lobbies::PreGameLobby,
    pub attendees: Vec<lobbies::LobbyAttendee>,
}

pub async fn list(
    State(state): State<AppState>,
    actor:        AuthUser,
) -> Result<Json<Vec<LobbyWithAttendees>>> {
    crate::auth::middleware::require_perm(&actor, "nav.events")?;

    let rows = lobbies::list(&state.pool).await?;
    let mut out = Vec::with_capacity(rows.len());
    for lobby in rows {
        let attendees = lobbies::list_attendees(&state.pool, lobby.id).await?;
        out.push(LobbyWithAttendees { lobby, attendees });
    }
    Ok(Json(out))
}

// ── POST /api/events/lobbies ──────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateBody {
    pub name:             String,
    #[serde(default = "default_radius")]
    pub radius:           i64,
    #[serde(default = "default_max_players")]
    pub max_players:      i64,
    #[serde(default)]
    pub allowed_players:  Option<Vec<String>>,
    #[serde(default = "default_linked_event_type")]
    pub linked_event_type: String,
    #[serde(default)]
    pub linked_event_id:   Option<i64>,
    /// Where attendees land on launch.
    #[serde(default = "default_launch_dimension")]
    pub launch_dimension:  String,
    #[serde(default)]
    pub launch_x:          i64,
    #[serde(default = "default_launch_y")]
    pub launch_y:          i64,
    #[serde(default)]
    pub launch_z:          i64,
}

fn default_radius()             -> i64 { 32 }
fn default_max_players()        -> i64 { 16 }
fn default_linked_event_type()  -> String { "manual".into() }
fn default_launch_dimension()   -> String { "minecraft:overworld".into() }
fn default_launch_y()           -> i64 { 70 }

fn validate(body: &CreateBody) -> Result<()> {
    let name = body.name.trim();
    if name.is_empty() || name.len() > 60 {
        return Err(AppError::BadRequest("Name must be 1–60 characters".into()));
    }
    if body.radius < 8 || body.radius > 256 {
        return Err(AppError::BadRequest("radius must be 8–256".into()));
    }
    if body.max_players < 1 || body.max_players > 100 {
        return Err(AppError::BadRequest("max_players must be 1–100".into()));
    }
    let valid_types = ["manual", "countdown", "rising_oceans", "bounty_board"];
    if !valid_types.contains(&body.linked_event_type.as_str()) {
        return Err(AppError::BadRequest(format!(
            "linked_event_type must be one of: {}", valid_types.join(", "),
        )));
    }
    if body.linked_event_type != "manual" && body.linked_event_id.is_none() {
        return Err(AppError::BadRequest(
            "linked_event_id is required for non-manual lobbies".into(),
        ));
    }
    Ok(())
}

pub async fn create(
    State(state): State<AppState>,
    actor:        AuthUser,
    Json(body):   Json<CreateBody>,
) -> Result<(StatusCode, Json<lobbies::PreGameLobby>)> {
    crate::auth::middleware::require_perm(&actor, "events.lobby.manage")?;
    validate(&body)?;

    let allowed_json = body.allowed_players
        .as_ref()
        .filter(|v| !v.is_empty())
        .map(|v| serde_json::to_string(v).ok())
        .flatten();

    // Ensure the lobby dimension exists; deploy once if needed.
    // The first lobby ever created kicks off the dimension deploy.  We do
    // this here (not on startup) so existing installs aren't forced to
    // restart MC at boot just to spin up a feature they may not use.
    lobby_runner::ensure_lobby_dimension(&state.config).await?;

    let row = lobbies::create(
        &state.pool,
        body.name.trim(),
        0, 66, 0,                                  // lobby spawn (centre of the platform)
        body.radius, body.max_players,
        allowed_json.as_deref(),
        &body.linked_event_type, body.linked_event_id,
        &body.launch_dimension, body.launch_x, body.launch_y, body.launch_z,
        &actor.email,
    ).await?;

    // Created lobbies start in "open" status — admins can lock later.
    lobbies::update_status(&state.pool, row.id, "open").await?;
    let row = lobbies::get(&state.pool, row.id).await?.unwrap_or(row);

    Ok((StatusCode::CREATED, Json(row)))
}

// ── DELETE /api/events/lobbies/:id ────────────────────────────────────────────

pub async fn delete(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(id):     Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.lobby.manage")?;
    let row = lobbies::get(&state.pool, id).await?
        .ok_or_else(|| AppError::NotFound(format!("Lobby {id} not found")))?;
    if !["pending", "open", "closed"].contains(&row.status.as_str()) {
        return Err(AppError::BadRequest(format!(
            "Can't delete a lobby in '{}' status — close it first", row.status,
        )));
    }
    lobbies::delete(&state.pool, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/events/lobbies/:id/join ────────────────────────────────────────

#[derive(Deserialize)]
pub struct JoinBody {
    /// IGN to join.  If omitted, defaults to the acting user's first linked IGN.
    pub ign: Option<String>,
}

pub async fn join(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(id):     Path<i64>,
    Json(body):   Json<JoinBody>,
) -> Result<StatusCode> {
    let lobby = lobbies::get(&state.pool, id).await?
        .ok_or_else(|| AppError::NotFound(format!("Lobby {id} not found")))?;
    if !["open"].contains(&lobby.status.as_str()) {
        return Err(AppError::BadRequest(format!(
            "Lobby is '{}', cannot join", lobby.status
        )));
    }

    // Resolve target IGN
    let ign = match body.ign {
        Some(i) => i,
        None    => first_linked_ign(&state, &actor.email).await?
            .ok_or_else(|| AppError::BadRequest("No linked Minecraft account".into()))?,
    };

    // Permission: must be the actor's own IGN or actor has manage perm.
    let can_manage = actor.has("events.lobby.manage");
    if !can_manage && !is_linked_to(&state, &actor.email, &ign).await {
        return Err(AppError::Forbidden(format!(
            "You don't have permission to add {ign} to a lobby",
        )));
    }

    // Whitelist check
    if let Some(json) = &lobby.allowed_players_json {
        let allowed: Vec<String> = serde_json::from_str(json).unwrap_or_default();
        if !allowed.iter().any(|x| x.eq_ignore_ascii_case(&ign)) {
            return Err(AppError::Forbidden(format!(
                "{ign} is not on this lobby's invite list",
            )));
        }
    }

    // Capacity check
    let active = lobbies::count_active_attendees(&state.pool, id).await?;
    if active >= lobby.max_players {
        return Err(AppError::Conflict(format!(
            "Lobby is full ({}/{} players)", active, lobby.max_players,
        )));
    }

    // Snapshot pre-event location (best effort — null if we don't have it).
    let snap = player_snapshots::get_by_ign(&state.pool, &ign).await?;
    let pre_dim = snap.as_ref().map(|s| s.dimension.clone());
    let pre_x   = snap.as_ref().map(|s| s.x);
    let pre_y   = snap.as_ref().map(|s| s.y);
    let pre_z   = snap.as_ref().map(|s| s.z);

    lobbies::add_attendee(&state.pool, id, &ign, pre_dim.as_deref(), pre_x, pre_y, pre_z).await?;

    // TP into the lobby (runner manages this so it can also enforce perimeter).
    lobby_runner::tp_into_lobby(&state.config, &lobby, &ign).await;

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/events/lobbies/:id/leave ───────────────────────────────────────

#[derive(Deserialize, Default)]
pub struct LeaveBody {
    pub ign: Option<String>,
}

pub async fn leave(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(id):     Path<i64>,
    Json(body):   Json<LeaveBody>,
) -> Result<StatusCode> {
    let lobby = lobbies::get(&state.pool, id).await?
        .ok_or_else(|| AppError::NotFound(format!("Lobby {id} not found")))?;

    let ign = match body.ign {
        Some(i) => i,
        None    => first_linked_ign(&state, &actor.email).await?
            .ok_or_else(|| AppError::BadRequest("No linked Minecraft account".into()))?,
    };

    let can_manage = actor.has("events.lobby.manage");
    if !can_manage && !is_linked_to(&state, &actor.email, &ign).await {
        return Err(AppError::Forbidden("Not your linked account".into()));
    }

    // Look up the attendee row so we can TP them back to pre-event coords.
    let attendees = lobbies::list_attendees(&state.pool, id).await?;
    if let Some(att) = attendees.iter().find(|a| a.player_ign.eq_ignore_ascii_case(&ign)) {
        lobby_runner::tp_attendee_home(&state.config, &lobby, att).await;
        lobbies::remove_attendee(&state.pool, id, &ign).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/events/lobbies/:id/launch ──────────────────────────────────────

pub async fn launch(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(id):     Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.lobby.manage")?;

    let lobby = lobbies::get(&state.pool, id).await?
        .ok_or_else(|| AppError::NotFound(format!("Lobby {id} not found")))?;
    if !["open", "locked"].contains(&lobby.status.as_str()) {
        return Err(AppError::BadRequest(format!(
            "Cannot launch a lobby in '{}' status", lobby.status,
        )));
    }
    let attendees = lobbies::list_attendees(&state.pool, id).await?;
    let active: Vec<_> = attendees.into_iter()
        .filter(|a| a.status == "joined")
        .collect();
    if active.is_empty() {
        return Err(AppError::BadRequest("No attendees to launch".into()));
    }

    lobbies::update_status(&state.pool, id, "launching").await?;

    // Fire-and-forget background ceremony (bossbar + fade + TP).
    let cfg = state.config.clone();
    let pool = state.pool.clone();
    let lobby_clone = lobby.clone();
    tokio::spawn(async move {
        if let Err(e) = lobby_runner::run_launch_ceremony(&cfg, &pool, &lobby_clone, &active).await {
            tracing::error!(lobby_id = id, error = ?e, "Lobby launch ceremony failed");
            let _ = lobbies::update_status(&pool, id, "open").await;
        }
    });

    Ok(StatusCode::ACCEPTED)
}

// ── POST /api/events/lobbies/:id/close ───────────────────────────────────────

pub async fn close(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(id):     Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.lobby.manage")?;

    let lobby = lobbies::get(&state.pool, id).await?
        .ok_or_else(|| AppError::NotFound(format!("Lobby {id} not found")))?;

    let attendees = lobbies::list_attendees(&state.pool, id).await?;
    for att in &attendees {
        lobby_runner::tp_attendee_home(&state.config, &lobby, att).await;
    }
    lobbies::mark_attendees_status(&state.pool, id, "returned").await?;
    lobbies::update_status(&state.pool, id, "closed").await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async fn first_linked_ign(state: &AppState, email: &str) -> Result<Option<String>> {
    Ok(sqlx::query_scalar::<_, String>(
        "SELECT ign FROM player_links WHERE LOWER(email) = LOWER(?) ORDER BY id ASC LIMIT 1",
    )
    .bind(email)
    .fetch_optional(&state.pool)
    .await?)
}

async fn is_linked_to(state: &AppState, email: &str, ign: &str) -> bool {
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT ign FROM player_links WHERE LOWER(email) = LOWER(?)",
    )
    .bind(email)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    rows.iter().any(|x| x.eq_ignore_ascii_case(ign))
}
