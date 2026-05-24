//! Lobby ceremony + perimeter helpers.
//!
//! Three concerns live here:
//!   1. `ensure_lobby_dimension` — deploy + verify the lobby dimension
//!      datapack on first use.  Idempotent.
//!   2. TP helpers — into-lobby and back-home, used by the handlers.
//!   3. `run_launch_ceremony` — the bossbar countdown + brief blindness +
//!      simultaneous TP into the linked event area.

use std::time::Duration;

use crate::{
    config::Config,
    db::lobbies::{LobbyAttendee, PreGameLobby},
    error::Result,
    minecraft::{
        console,
        countdown as mc,
        dimensions::{self, DimensionSpec},
    },
    state::AppState,
};

/// Name of the shared lobby dimension (one dimension reused for all lobbies).
pub const LOBBY_DIM_NAME: &str = "lobby";
/// Full dimension ID.
fn lobby_dimension_id() -> String { format!("{}:{}", dimensions::NAMESPACE, LOBBY_DIM_NAME) }

const BOSSBAR_ID: &str = "rsc:lobby_launch";

// ── Dimension setup ──────────────────────────────────────────────────────────

/// Make sure the lobby dimension exists.  Safe to call repeatedly.
///
/// Strategy:
///   • Always re-write the datapack (cheap; in case Paper schema changes).
///   • Check whether the dimension is already loaded via `/forceload`.  If
///     it works, no restart needed.  Otherwise restart + verify.
pub async fn ensure_lobby_dimension(cfg: &Config) -> Result<()> {
    let spec = DimensionSpec::lobby(LOBBY_DIM_NAME);
    dimensions::deploy_dimension(cfg, &spec).await?;

    // Probe: try a no-op execute in the dimension.  If MC complains "Unknown
    // dimension", we need to restart to register the type.  We use a benign
    // command (`time query day`) that prints to chat but doesn't change state.
    let dim_id = lobby_dimension_id();
    let probe = format!("execute in {dim_id} run time query day");
    let _ = console::send(cfg, &probe).await;

    // We can't easily read MC's command result over the FIFO.  Conservative
    // path: ask the server whether the dimension is registered by checking
    // `/datapack list` for our pack name via the latest log.  If absent,
    // restart+verify.  For now: rely on the deploy step + ASSUME registered.
    // If a player launches and TP fails silently, the runner's perimeter
    // sweep will detect they're not in the dim and we'll surface an error.
    //
    // First-deploy ergonomics: if this is the very first call (no log
    // mentions "lobby" yet), we restart + verify proactively.
    let needs_restart = !crate::gcloud::ssh::run_with_timeout(
        cfg,
        &format!(
            "grep -F 'redstonecipher:lobby' '{}/logs/latest.log' 2>/dev/null | head -1",
            cfg.mc_server_dir,
        ),
        Duration::from_secs(10),
    )
    .await
    .map(|(out, _)| !out.trim().is_empty())
    .unwrap_or(false);

    if needs_restart {
        tracing::info!("First-time lobby dimension deploy — restarting MC to register");
        dimensions::restart_and_verify(cfg, LOBBY_DIM_NAME).await?;
        // Build the lobby platform now that the dim is live.
        dimensions::build_lobby_platform(cfg, &dim_id, 32).await?;
        dimensions::exclude_from_bluemap(cfg, LOBBY_DIM_NAME).await;
    }
    Ok(())
}

// ── TP helpers ───────────────────────────────────────────────────────────────

/// Teleport `ign` into the given lobby at its spawn point.
pub async fn tp_into_lobby(cfg: &Config, lobby: &PreGameLobby, ign: &str) {
    let dim = lobby_dimension_id();
    // Use `execute in <dim>` so the dimension change happens.
    let cmd = format!(
        "execute in {dim} run tp {ign} {x}.5 {y} {z}.5",
        x = lobby.lobby_x, y = lobby.lobby_y, z = lobby.lobby_z,
    );
    let _ = console::send(cfg, &cmd).await;
    // Friendly arrival message.
    let intro = serde_json::json!({
        "text": format!("Welcome to {} — wait for the host to launch.", lobby.name),
        "color": "yellow",
    }).to_string();
    let _ = mc::show_actionbar(cfg, ign, &intro).await;
}

/// Teleport `att` back to their pre-event coordinates (or world spawn if none).
pub async fn tp_attendee_home(cfg: &Config, _lobby: &PreGameLobby, att: &LobbyAttendee) {
    let ign = &att.player_ign;
    if let (Some(dim), Some(x), Some(y), Some(z)) =
        (&att.pre_event_dimension, att.pre_event_x, att.pre_event_y, att.pre_event_z)
    {
        let cmd = format!("execute in {dim} run tp {ign} {x:.1} {y:.1} {z:.1}");
        let _ = console::send(cfg, &cmd).await;
    } else {
        // Fall back to spawn.
        let _ = console::send(cfg, &format!("tp {ign} 0 100 0")).await;
    }
}

// ── Launch ceremony ──────────────────────────────────────────────────────────

const COUNTDOWN_SECS: u32 = 5;

/// Run the bossbar countdown + brief blindness + simultaneous TP.
/// Called as a fire-and-forget task by the launch handler.
pub async fn run_launch_ceremony(
    state:     &AppState,
    lobby:     &PreGameLobby,
    attendees: &[LobbyAttendee],
) -> Result<()> {
    let cfg = &state.config;
    let pool = &state.pool;
    let igns: Vec<&str> = attendees.iter().map(|a| a.player_ign.as_str()).collect();
    let players_arg = igns.join(",");

    // 1. Bossbar countdown.
    let name_text = serde_json::json!({
        "text": format!("Launching {} in {}…", lobby.name, COUNTDOWN_SECS),
        "color": "yellow",
        "bold": true,
    }).to_string();
    let _ = mc::bossbar_add(cfg, BOSSBAR_ID, &name_text).await;
    let _ = mc::bossbar_set_players(cfg, BOSSBAR_ID, &players_arg).await;
    let _ = mc::bossbar_set_color(cfg, BOSSBAR_ID, "yellow").await;
    let _ = mc::bossbar_set_max(cfg, BOSSBAR_ID, COUNTDOWN_SECS).await;
    let _ = mc::bossbar_set_value(cfg, BOSSBAR_ID, COUNTDOWN_SECS).await;
    let _ = mc::bossbar_set_visible(cfg, BOSSBAR_ID, true).await;

    for n in (1..=COUNTDOWN_SECS).rev() {
        let name = serde_json::json!({
            "text": format!("Launching {} in {n}…", lobby.name),
            "color": if n <= 2 { "red" } else { "yellow" },
            "bold": true,
        }).to_string();
        let _ = mc::bossbar_set_name(cfg, BOSSBAR_ID, &name).await;
        let _ = mc::bossbar_set_value(cfg, BOSSBAR_ID, n).await;

        // Tick sound for the last 3 seconds (only if MC supports it on the server).
        if n <= 3 {
            for ign in &igns {
                let _ = console::send(
                    cfg,
                    &format!("playsound minecraft:block.note_block.hat master {ign} ~ ~ ~ 1 {}", 0.8 + 0.2 * (4 - n) as f32),
                ).await;
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }

    // 2. Brief blindness for the TP cut.
    for ign in &igns {
        let _ = console::send(
            cfg,
            &format!("effect give {ign} minecraft:blindness 2 0 true"),
        ).await;
    }

    // 3. GO! title.
    let go = serde_json::json!({"text":"GO!","color":"green","bold":true}).to_string();
    for ign in &igns {
        let _ = mc::set_title_times(cfg, ign, 0, 30, 10).await;
        let _ = mc::show_title(cfg, ign, &go).await;
    }

    // 4. Simultaneous TP into the launch destination.
    for ign in &igns {
        let cmd = format!(
            "execute in {dim} run tp {ign} {x}.5 {y} {z}.5",
            dim = lobby.launch_dimension,
            x   = lobby.launch_x,
            y   = lobby.launch_y,
            z   = lobby.launch_z,
        );
        let _ = console::send(cfg, &cmd).await;
    }

    // 5. Bossbar cleanup + state mark.
    let _ = mc::bossbar_remove(cfg, BOSSBAR_ID).await;
    let _ = crate::db::lobbies::mark_attendees_status(pool, lobby.id, "launched").await;
    let _ = crate::db::lobbies::update_status(pool, lobby.id, "launched").await;

    // 6. Auto-start the linked event (countdown / rising oceans / bounty
    //    board).  'manual' is a no-op — the admin starts the event from
    //    its own tab.  We swallow errors here so a misconfigured event
    //    doesn't undo the successful TP.
    if let Some(eid) = lobby.linked_event_id {
        if let Err(e) = trigger_linked_event(state, &lobby.linked_event_type, eid).await {
            tracing::warn!(lobby_id = lobby.id, error = ?e,
                "Linked event auto-start failed; admin must start it manually");
        }
    }
    Ok(())
}

/// Call the appropriate `do_start` helper for the linked event type.
async fn trigger_linked_event(
    state: &AppState,
    kind:  &str,
    id:    i64,
) -> Result<()> {
    match kind {
        "countdown"     => crate::handlers::events::do_start(state, id, "lobby").await,
        "rising_oceans" => crate::handlers::rising_oceans::do_start(state, id).await,
        "bounty_board"  => crate::handlers::bounty_board::do_start(state, id).await,
        "manual"        => Ok(()),
        other => Err(crate::error::AppError::BadRequest(format!(
            "Unknown linked_event_type '{other}'"
        ))),
    }
}
