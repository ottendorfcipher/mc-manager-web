//! REST endpoints for player aliases (display names).
//!
//!   GET    /api/players/:ign/alias   → { ign, alias | null }
//!   PUT    /api/players/:ign/alias   → set alias
//!   DELETE /api/players/:ign/alias   → remove alias
//!   GET    /api/players/aliases      → list all aliases (admin)

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::middleware::AuthUser,
    db::players,
    error::{AppError, Result},
    minecraft::aliases,
    state::AppState,
};

// ── Shared type ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct AliasPayload {
    pub ign:   String,
    pub alias: Option<String>,
}

// ── GET /api/players/:ign/alias ──────────────────────────────────────────────

pub async fn get(
    State(state): State<AppState>,
    _: AuthUser,
    Path(ign): Path<String>,
) -> Result<Json<AliasPayload>> {
    let alias = aliases::get_alias(&state.pool, &ign).await;
    Ok(Json(AliasPayload { ign, alias }))
}

// ── PUT /api/players/:ign/alias ──────────────────────────────────────────────

#[derive(Deserialize)]
pub struct SetAliasBody {
    pub alias: String,
}

pub async fn set_alias(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(ign):    Path<String>,
    Json(body):   Json<SetAliasBody>,
) -> Result<Json<AliasPayload>> {
    require_alias_permission(&actor, &state.pool, &ign).await?;

    let alias = body.alias.trim().to_string();
    if alias.is_empty() || alias.len() > 32 {
        return Err(AppError::BadRequest(
            "Alias must be 1–32 characters".into(),
        ));
    }
    // Basic character whitelist: printable ASCII, spaces OK, no control chars.
    if alias.chars().any(|c| c.is_control()) {
        return Err(AppError::BadRequest(
            "Alias contains invalid characters".into(),
        ));
    }

    aliases::set_alias(&state.pool, &state.config, &ign, &alias).await
        .map_err(|e| AppError::Internal(e))?;

    tracing::info!(actor = %actor.email, ign, alias, "alias: set");
    Ok(Json(AliasPayload { ign, alias: Some(alias) }))
}

// ── DELETE /api/players/:ign/alias ──────────────────────────────────────────

pub async fn delete_alias(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(ign):    Path<String>,
) -> Result<StatusCode> {
    require_alias_permission(&actor, &state.pool, &ign).await?;

    aliases::clear_alias(&state.pool, &state.config, &ign).await
        .map_err(|e| AppError::Internal(e))?;

    tracing::info!(actor = %actor.email, ign, "alias: cleared");
    Ok(StatusCode::NO_CONTENT)
}

// ── GET /api/players/aliases ─────────────────────────────────────────────────

pub async fn list_all(
    State(state): State<AppState>,
    _: AuthUser,
) -> Result<Json<Vec<AliasPayload>>> {
    let all = aliases::list_all_aliases(&state.pool).await;
    let out = all.into_iter()
        .map(|(ign, alias)| AliasPayload { ign, alias: Some(alias) })
        .collect();
    Ok(Json(out))
}

// ── Auth helper ──────────────────────────────────────────────────────────────
//
// A user can manage the alias for any of their own linked IGNs.
// A global_admin can manage any IGN.

async fn require_alias_permission(
    actor: &AuthUser,
    pool:  &sqlx::SqlitePool,
    ign:   &str,
) -> Result<()> {
    if actor.role == "global_admin" { return Ok(()); }

    // Check whether this IGN is linked to the requesting user.
    let links = players::list_for_user(pool, &actor.email).await
        .unwrap_or_default();
    if links.iter().any(|l| l.ign == ign) { return Ok(()); }

    Err(AppError::Forbidden(
        "You can only set an alias for your own linked Minecraft accounts".into(),
    ))
}
