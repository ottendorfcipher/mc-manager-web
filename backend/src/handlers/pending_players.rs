use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::middleware::AuthUser,
    db::{audit, pending_players, players},
    error::{AppError, Result},
    state::AppState,
};

// ── Internal watchdog endpoint ─────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct PlayerJoinedBody {
    pub ign:  String,
    pub uuid: Option<String>,
}

#[derive(Serialize)]
pub struct PlayerJoinedResponse {
    pub action: &'static str,
}

/// POST /internal/player-joined
/// Called by the mc-server-1 watchdog on every join event.
/// Authenticated by a shared bearer token (WATCHDOG_TOKEN env var).
pub async fn player_joined(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PlayerJoinedBody>,
) -> Result<Json<PlayerJoinedResponse>> {
    // Validate bearer token.
    let token = state.config.watchdog_token.as_deref().unwrap_or("");
    let provided = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");

    if token.is_empty() || provided != token {
        return Err(AppError::Unauthenticated);
    }

    let ign = body.ign.trim().to_string();
    if ign.is_empty() {
        return Err(AppError::BadRequest("ign is required".into()));
    }

    let action = pending_players::record_join(
        &state.pool,
        &ign,
        body.uuid.as_deref(),
    )
    .await?;

    Ok(Json(PlayerJoinedResponse { action }))
}

// ── Admin endpoints ────────────────────────────────────────────────────────────

/// GET /api/players/pending
pub async fn list(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<Vec<pending_players::PendingPlayer>>> {
    crate::auth::middleware::require_perm(&actor, "players.pending.view")?;
    Ok(Json(pending_players::list_pending(&state.pool).await?))
}

#[derive(Deserialize)]
pub struct ApproveBody {
    /// The site user email to link this IGN to.
    pub email: String,
}

/// POST /api/players/pending/:ign/approve
/// Links the IGN to the given user email and marks the pending record approved.
pub async fn approve(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(ign): Path<String>,
    Json(body): Json<ApproveBody>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "players.pending.manage")?;

    // Create the player_links row — this is what allows future joins.
    players::upsert(&state.pool, &body.email, &ign).await?;

    // Mark the pending record as approved.
    pending_players::approve(&state.pool, &ign).await?;

    audit::log(&state.pool, &actor.email, "pending_player_approve", Some(&ign), Some(&body.email)).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/players/pending/:ign
/// Rejects the player — future join attempts return "ban".
pub async fn reject(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(ign): Path<String>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "players.pending.manage")?;

    pending_players::reject(&state.pool, &ign).await?;

    audit::log(&state.pool, &actor.email, "pending_player_reject", Some(&ign), None).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/players/rejected
pub async fn list_rejected(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<Vec<pending_players::PendingPlayer>>> {
    crate::auth::middleware::require_perm(&actor, "players.pending.view")?;
    Ok(Json(pending_players::list_rejected(&state.pool).await?))
}

/// POST /api/players/rejected/:ign/reinstate
/// Moves a rejected player back to pending so they can be re-evaluated.
pub async fn reinstate(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(ign): Path<String>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "players.pending.manage")?;

    pending_players::reinstate(&state.pool, &ign).await?;

    audit::log(&state.pool, &actor.email, "pending_player_reinstate", Some(&ign), None).await?;
    Ok(StatusCode::NO_CONTENT)
}
