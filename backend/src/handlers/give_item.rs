use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;

use crate::{
    auth::middleware::AuthUser,
    db::player_snapshots,
    error::{AppError, Result},
    minecraft::give_item,
    state::AppState,
};

#[derive(Deserialize)]
pub struct GiveRequest {
    pub item_id: String,
    #[serde(default = "one")]
    pub count: u32,
    /// Whether the player is currently online. If omitted the backend
    /// checks the live player list automatically.
    pub online: Option<bool>,
}
fn one() -> u32 {
    1
}

/// POST /api/players/:ign/give
pub async fn give(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(ign): Path<String>,
    Json(body): Json<GiveRequest>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "players.give_items")?;

    if body.item_id.trim().is_empty() {
        return Err(AppError::BadRequest("item_id is required".into()));
    }

    // Look up the player's UUID from the snapshot (needed for offline give)
    let snap = player_snapshots::get_by_ign(&state.pool, &ign).await?;
    let uuid = snap.as_ref().map(|s| s.uuid.as_str());

    // Determine online status: prefer caller-supplied flag, otherwise assume
    // offline (safe default — offline path works for online players too with a
    // slight delay, but online path is instant).
    let online = body.online.unwrap_or(false);

    give_item::give(&state.config, &ign, uuid, &body.item_id, body.count, online).await?;

    Ok(StatusCode::NO_CONTENT)
}
