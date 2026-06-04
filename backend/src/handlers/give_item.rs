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
    validation,
};

#[derive(Deserialize)]
pub struct GiveRequest {
    pub item_id: String,
    #[serde(default = "one")]
    pub count: u32,
    /// Whether the player is currently online.  If true, uses the instant
    /// RCON `give` command; if false (or omitted), edits the NBT playerdata
    /// file directly so the item appears when they next log in.
    pub online: Option<bool>,
    /// Player UUID — if supplied by the client we use it directly and skip
    /// the snapshot lookup.  Sending this makes offline delivery reliable
    /// even when no snapshot has been captured yet.
    pub uuid: Option<String>,
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

    validation::validate_ign(&ign)?;
    validation::validate_item_id(body.item_id.trim())?;

    // Use client-supplied UUID first; fall back to snapshot lookup.
    let uuid_owned: Option<String> = if let Some(u) = body.uuid.filter(|s| !s.is_empty()) {
        Some(u)
    } else {
        player_snapshots::get_by_ign(&state.pool, &ign)
            .await?
            .map(|s| s.uuid)
    };
    let uuid = uuid_owned.as_deref();

    let online = body.online.unwrap_or(false);

    give_item::give(&state.config, &ign, uuid, &body.item_id, body.count, online).await?;

    Ok(StatusCode::NO_CONTENT)
}
