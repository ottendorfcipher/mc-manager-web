use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};

use serde::Serialize;
use ts_rs::TS;

use crate::{
    auth::middleware::AuthUser,
    db::player_snapshots,
    error::{AppError, Result},
    minecraft::player_data,
    state::AppState,
};

/// Location-only view of a player — deliberately excludes inventory so it can be
/// exposed to members (who may see where everyone is, but not what they carry).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct PlayerLocation {
    pub ign: String,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub dimension: String,
    pub captured_at: String,
}

/// GET /api/players/locations
/// ALL players' locations (no inventory). Gated on `players.location.view_all`
/// (member+) so the map can show everyone's position to regular members.
pub async fn locations(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<Vec<PlayerLocation>>> {
    crate::auth::middleware::require_perm(&actor, "players.location.view_all")?;
    let out = player_snapshots::list(&state.pool)
        .await?
        .into_iter()
        .map(|s| PlayerLocation {
            ign: s.ign,
            x: s.x,
            y: s.y,
            z: s.z,
            dimension: s.dimension,
            captured_at: s.captured_at,
        })
        .collect();
    Ok(Json(out))
}

/// GET /api/players/snapshots
/// Admins get all; members get only their own linked IGNs.
pub async fn list(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<Vec<player_snapshots::PlayerSnapshot>>> {
    let can_view_any = actor.permissions.contains("players.view_any");

    if can_view_any {
        return Ok(Json(player_snapshots::list(&state.pool).await?));
    }

    // Member: return only snapshots for their own linked players
    let own_igns: Vec<String> = player_links::list_by_email(&state.pool, &actor.email)
        .await?
        .into_iter()
        .map(|l| l.ign)
        .collect();

    let mut out = Vec::new();
    for ign in &own_igns {
        if let Some(snap) = player_snapshots::get_by_ign(&state.pool, ign).await? {
            out.push(snap);
        }
    }
    Ok(Json(out))
}

/// GET /api/players/snapshots/:ign
pub async fn get(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(ign): Path<String>,
) -> Result<Json<player_snapshots::PlayerSnapshot>> {
    let can_view_any = actor.permissions.contains("players.view_any");

    if !can_view_any {
        // Members may only fetch their own IGNs
        let own: Vec<String> = player_links::list_by_email(&state.pool, &actor.email)
            .await?
            .into_iter()
            .map(|l| l.ign)
            .collect();
        if !own.iter().any(|i| i.eq_ignore_ascii_case(&ign)) {
            return Err(AppError::Forbidden(
                "Cannot view another player's snapshot".into(),
            ));
        }
    }

    player_snapshots::get_by_ign(&state.pool, &ign)
        .await?
        .map(Json)
        .ok_or_else(|| AppError::NotFound(format!("No snapshot for {ign}")))
}

/// POST /api/players/snapshots/refresh
/// Flush MC saves, re-run extraction, upsert DB. Admin only.
pub async fn refresh(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<(StatusCode, Json<serde_json::Value>)> {
    crate::auth::middleware::require_perm(&actor, "players.view_any")?;

    let count = player_data::refresh_snapshots(&state.pool, &state.config).await?;
    Ok((
        StatusCode::OK,
        Json(serde_json::json!({ "updated": count })),
    ))
}

// ── helper re-export ──────────────────────────────────────────────────────────

mod player_links {
    use crate::error::Result;
    use sqlx::SqlitePool;

    pub struct LinkRow {
        pub ign: String,
    }

    pub async fn list_by_email(pool: &SqlitePool, email: &str) -> Result<Vec<LinkRow>> {
        Ok(
            sqlx::query_as::<_, (String,)>("SELECT ign FROM player_links WHERE email = ?")
                .bind(email)
                .fetch_all(pool)
                .await?
                .into_iter()
                .map(|(ign,)| LinkRow { ign })
                .collect(),
        )
    }
}
