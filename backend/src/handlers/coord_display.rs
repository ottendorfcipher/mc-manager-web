use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::middleware::AuthUser,
    db::{player_snapshots, prefs},
    error::{AppError, Result},
    gcloud::ssh,
    state::AppState,
};

#[derive(Serialize)]
pub struct CoordDisplayStatus {
    pub enabled: bool,
    pub online:  bool,
    pub ign:     String,
}

#[derive(Deserialize)]
pub struct SetCoordDisplay {
    pub enabled: bool,
}

// ── Pref key ──────────────────────────────────────────────────────────────────

fn pref_key(ign: &str) -> String {
    format!("coord_display:{ign}")
}

// ── Permission helper ─────────────────────────────────────────────────────────

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
        "You do not have permission to manage {ign}'s coordinate display"
    )))
}

// ── GET /api/players/:ign/coord-display ───────────────────────────────────────
//
// Source of truth is the preferences DB key.  This is always current regardless
// of whether the player is online (the FIFO command is the in-game authority;
// the DB is the web-interface authority — they are kept in sync on every POST).

pub async fn get(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(ign): Path<String>,
) -> Result<Json<CoordDisplayStatus>> {
    check_perm(&state, &actor, &ign).await?;

    // Verify the player exists in our snapshots
    let _snap = player_snapshots::get_by_ign(&state.pool, &ign)
        .await?
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "No snapshot for {ign}. Refresh snapshots on the Inventory page first."
            ))
        })?;

    let online  = is_player_online(&state, &ign).await;
    let enabled = prefs::get(&state.pool, &pref_key(&ign))
        .await?
        .map(|v| v == "true")
        .unwrap_or(false);

    Ok(Json(CoordDisplayStatus { enabled, online, ign }))
}

// ── POST /api/players/:ign/coord-display ──────────────────────────────────────

pub async fn set(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(ign): Path<String>,
    Json(body): Json<SetCoordDisplay>,
) -> Result<StatusCode> {
    check_perm(&state, &actor, &ign).await?;

    // Verify the player exists
    player_snapshots::get_by_ign(&state.pool, &ign)
        .await?
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "No snapshot for {ign}. Refresh snapshots on the Inventory page first."
            ))
        })?;

    let online = is_player_online(&state, &ign).await;

    // 1. Persist to DB — the web interface source of truth
    prefs::set(
        &state.pool,
        &pref_key(&ign),
        if body.enabled { "true" } else { "false" },
    )
    .await?;

    // 2. Apply in-game:
    //    - Online  → instant FIFO tag command (datapack tick picks it up)
    //    - Offline → Python NBT edit (takes effect on next login)
    if online {
        let mc_cmd = if body.enabled {
            format!("tag {ign} add ch_on")
        } else {
            format!("tag {ign} remove ch_on")
        };
        let _ = ssh::fifo_command(&state.config, &mc_cmd).await;
    } else {
        if let Ok(snap) = player_snapshots::get_by_ign(&state.pool, &ign).await {
            if let Some(snap) = snap {
                let safe_uuid = snap.uuid.replace('\'', "");
                let enabled_s = if body.enabled { "true" } else { "false" };
                let venv      = venv_path(&state);
                let script    = state.config.mc_scripts_dir.clone();
                let cmd = format!(
                    "'{venv}' '{script}/coord-display.py' set '{safe_uuid}' {enabled_s}"
                );
                let _ = ssh::run_with_timeout(
                    &state.config,
                    &cmd,
                    std::time::Duration::from_secs(10),
                )
                .await;
            }
        }
    }

    Ok(StatusCode::NO_CONTENT)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn venv_path(state: &AppState) -> String {
    format!(
        "{}/venv/bin/python3",
        std::path::Path::new(&state.config.mc_scripts_dir)
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or("/opt/minecraft")
    )
}

async fn is_player_online(state: &AppState, ign: &str) -> bool {
    let cmd = format!(
        "grep -E '(joined the game|left the game)' '{}/logs/latest.log' 2>/dev/null | tail -100",
        state.config.mc_server_dir
    );
    if let Ok((out, _)) =
        ssh::run_with_timeout(&state.config, &cmd, std::time::Duration::from_secs(10)).await
    {
        let mut online = false;
        for line in out.lines() {
            if line.contains("joined the game") && line.contains(ign) {
                online = true;
            } else if line.contains("left the game") && line.contains(ign) {
                online = false;
            }
        }
        return online;
    }
    false
}
