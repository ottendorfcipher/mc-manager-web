//! GET / PUT preferences for the nearest-pin HUD shown in-game.
//!
//! Two switches per linked Minecraft account:
//!   - show_team    – include team-visible pins in the consideration set
//!   - show_private – include the user's own private pins
//!
//! A master `enabled` flag is implied: HUD is OFF when both switches are off.
//! Preferences are stored in the generic `prefs` table under
//! `pin_hud:{ign}:show_team`, `pin_hud:{ign}:show_private`, and
//! `pin_hud:{ign}:owner` (so the background task knows whose private pins to
//! include).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::middleware::AuthUser,
    db::prefs,
    error::{AppError, Result},
    state::AppState,
};

#[derive(Serialize)]
pub struct PinHudStatus {
    pub ign:          String,
    pub show_team:    bool,
    pub show_private: bool,
}

#[derive(Deserialize)]
pub struct SetPinHud {
    pub show_team:    bool,
    pub show_private: bool,
}

// Key helpers
fn key_team(ign: &str)    -> String { format!("pin_hud:{ign}:show_team") }
fn key_private(ign: &str) -> String { format!("pin_hud:{ign}:show_private") }
fn key_owner(ign: &str)   -> String { format!("pin_hud:{ign}:owner") }

// ── Permission helper ─────────────────────────────────────────────────────────

/// The acting user may modify HUD prefs for any IGN they have linked, or for
/// any IGN at all if they hold `players.view_any`.
async fn check_perm(state: &AppState, actor: &AuthUser, ign: &str) -> Result<()> {
    if actor.has("players.view_any") {
        return Ok(());
    }
    let own: Vec<String> = sqlx::query_scalar(
        "SELECT ign FROM player_links WHERE LOWER(email) = LOWER(?)",
    )
    .bind(&actor.email)
    .fetch_all(&state.pool)
    .await?;
    if own.iter().any(|i| i.eq_ignore_ascii_case(ign)) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "You do not have permission to manage {ign}'s pin HUD"
    )))
}

// ── GET /api/players/:ign/pin-hud ─────────────────────────────────────────────

pub async fn get(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(ign):    Path<String>,
) -> Result<Json<PinHudStatus>> {
    check_perm(&state, &actor, &ign).await?;

    let show_team = prefs::get(&state.pool, &key_team(&ign))
        .await?
        .map(|v| v == "true")
        .unwrap_or(false);
    let show_private = prefs::get(&state.pool, &key_private(&ign))
        .await?
        .map(|v| v == "true")
        .unwrap_or(false);

    Ok(Json(PinHudStatus { ign, show_team, show_private }))
}

// ── PUT /api/players/:ign/pin-hud ─────────────────────────────────────────────

pub async fn set(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(ign):    Path<String>,
    Json(body):   Json<SetPinHud>,
) -> Result<StatusCode> {
    check_perm(&state, &actor, &ign).await?;

    prefs::set(&state.pool, &key_team(&ign),    if body.show_team    { "true" } else { "false" }).await?;
    prefs::set(&state.pool, &key_private(&ign), if body.show_private { "true" } else { "false" }).await?;

    // Record the owner email so the runner can resolve which private pins
    // are visible to this IGN.
    let owner: Option<String> = sqlx::query_scalar(
        "SELECT email FROM player_links WHERE LOWER(ign) = LOWER(?) ORDER BY id ASC LIMIT 1",
    )
    .bind(&ign)
    .fetch_optional(&state.pool)
    .await?;
    if let Some(owner_email) = owner {
        prefs::set(&state.pool, &key_owner(&ign), &owner_email).await?;
    }

    Ok(StatusCode::NO_CONTENT)
}
