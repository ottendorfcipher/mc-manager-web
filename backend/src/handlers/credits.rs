//! REST CRUD for scrolling credits — reusable cinematic text sequences
//! triggered when a player enters a music zone.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;

use crate::{
    auth::middleware::AuthUser,
    db::{credits, players},
    error::{AppError, Result},
    minecraft::credits_runner,
    state::AppState,
};

// ── GET /api/credits ─────────────────────────────────────────────────────────

pub async fn list(
    State(state): State<AppState>,
    actor:        AuthUser,
) -> Result<Json<Vec<credits::ScrollingCredits>>> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;
    Ok(Json(credits::list(&state.pool).await?))
}

// ── POST /api/credits ────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreditsBody {
    pub name:            String,
    pub lines_json:      String,
    pub scroll_speed_ms: i64,
    #[serde(default = "default_freeze")]
    pub freeze_player:   bool,
}

fn default_freeze() -> bool { true }

fn validate_body(body: &CreditsBody) -> Result<()> {
    let name = body.name.trim();
    if name.is_empty() || name.len() > 60 {
        return Err(AppError::BadRequest("Name must be 1–60 characters".into()));
    }
    if body.scroll_speed_ms < 500 || body.scroll_speed_ms > 5000 {
        return Err(AppError::BadRequest("scroll_speed_ms must be 500–5000".into()));
    }
    // Validate lines_json parses as a non-empty array of CreditLine.
    let lines: Vec<credits::CreditLine> = serde_json::from_str(&body.lines_json)
        .map_err(|e| AppError::BadRequest(format!("Invalid lines_json: {e}")))?;
    if lines.is_empty() {
        return Err(AppError::BadRequest("At least one credit line is required".into()));
    }
    for (i, line) in lines.iter().enumerate() {
        match line.line_type.as_str() {
            "heading" | "line" => {
                if line.text.as_deref().unwrap_or("").is_empty() {
                    return Err(AppError::BadRequest(
                        format!("Line {}: heading/line must have non-empty text", i + 1),
                    ));
                }
            }
            "blank" => {}
            other => {
                return Err(AppError::BadRequest(
                    format!("Line {}: unknown type '{other}'", i + 1),
                ));
            }
        }
    }
    Ok(())
}

pub async fn create(
    State(state): State<AppState>,
    actor:        AuthUser,
    Json(body):   Json<CreditsBody>,
) -> Result<(StatusCode, Json<credits::ScrollingCredits>)> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;
    validate_body(&body)?;

    let row = credits::create(
        &state.pool,
        body.name.trim(),
        &body.lines_json,
        body.scroll_speed_ms,
        body.freeze_player,
        &actor.email,
    )
    .await?;

    Ok((StatusCode::CREATED, Json(row)))
}

// ── PATCH /api/credits/:id ───────────────────────────────────────────────────

pub async fn update(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(id):     Path<i64>,
    Json(body):   Json<CreditsBody>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;
    validate_body(&body)?;

    let ok = credits::update(
        &state.pool,
        id,
        body.name.trim(),
        &body.lines_json,
        body.scroll_speed_ms,
        body.freeze_player,
    )
    .await?;

    if !ok {
        return Err(AppError::NotFound(format!("Credits {id} not found")));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ── DELETE /api/credits/:id ──────────────────────────────────────────────────

pub async fn delete(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(id):     Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;

    // Refuse to delete if any music zone references this credits sequence.
    if credits::is_referenced(&state.pool, id).await? {
        return Err(AppError::Conflict(
            "Cannot delete: this credits sequence is referenced by one or more music zones".into(),
        ));
    }

    let ok = credits::delete(&state.pool, id).await?;
    if !ok {
        return Err(AppError::NotFound(format!("Credits {id} not found")));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/credits/:id/preview ────────────────────────────────────────────

/// Play the credits sequence in-game for the requesting user right now.
/// Looks up the user's linked MC account to determine the target IGN.
pub async fn preview(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(id):     Path<i64>,
) -> Result<Json<serde_json::Value>> {
    crate::auth::middleware::require_perm(&actor, "music.play")?;

    let creds = credits::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Credits {id} not found")))?;

    // Find the actor's linked MC player.
    let linked = players::list_for_user(&state.pool, &actor.email).await?;
    let ign = linked
        .first()
        .map(|p| p.ign.clone())
        .ok_or_else(|| AppError::BadRequest(
            "You must have a linked Minecraft account to preview credits in-game".into(),
        ))?;

    // Use zone_id = 0 for preview (not a real zone).
    credits_runner::spawn_credits_playback(
        state.config.clone(),
        0,
        ign.clone(),
        creds,
        state.credits_active.clone(),
    );

    Ok(Json(serde_json::json!({ "status": "playing", "player": ign })))
}
