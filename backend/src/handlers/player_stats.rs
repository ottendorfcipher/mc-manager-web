//! Handler for per-player Minecraft statistics.
//!
//! GET /api/players/:ign/stats  — returns the raw MC stats JSON for the player.
//! Permission: `players.view_any` (admins) or own linked IGN.

use axum::{extract::{Path, State}, Json};

use crate::{
    auth::middleware::AuthUser,
    db::player_snapshots,
    error::{AppError, Result},
    minecraft::player_stats,
    state::AppState,
};

/// GET /api/players/:ign/stats
pub async fn get(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(ign):    Path<String>,
) -> Result<Json<serde_json::Value>> {
    let can_view_any = actor.permissions.contains("players.view_any");

    if !can_view_any {
        // Members may only view their own linked players' stats
        let own: Vec<String> = sqlx::query_as::<_, (String,)>(
            "SELECT ign FROM player_links WHERE email = ?",
        )
        .bind(&actor.email)
        .fetch_all(&state.pool)
        .await?
        .into_iter()
        .map(|(i,)| i)
        .collect();

        if !own.iter().any(|i| i.eq_ignore_ascii_case(&ign)) {
            return Err(AppError::Forbidden(
                "Cannot view another player's stats".into(),
            ));
        }
    }

    // Look up UUID from the snapshots table
    let snap = player_snapshots::get_by_ign(&state.pool, &ign)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("No snapshot found for {ign}")))?;

    let stats = player_stats::read_stats(&state.config, &snap.uuid)
        .await?
        .unwrap_or_else(|| serde_json::json!({ "stats": {} }));

    Ok(Json(stats))
}
