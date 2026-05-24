use std::time::{Duration, Instant};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse,
    },
    Json,
};
use serde::Deserialize;
use tokio_stream::{wrappers::BroadcastStream, StreamExt};
use tracing::warn;

use crate::{
    auth::middleware::AuthUser,
    db::{bounty_boards, worlds},
    error::{AppError, Result},
    minecraft::{bounty_runner::ActiveBountyBoard, mc_stats},
    state::AppState,
};

// ── GET /api/events/bounty-board/state ──────────────────────────────────────

pub async fn get_state(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<bounty_boards::BountyBoardStatePayload>> {
    crate::auth::middleware::require_perm(&actor, "nav.events")?;

    let recent = bounty_boards::list_recent(&state.pool, 20).await?;
    let active = {
        let guard = state.bounty_board_active.lock().await;
        match &*guard {
            None => None,
            Some(a) => {
                let stats = bounty_boards::get_tracked_stats(&state.pool, a.id).await.unwrap_or_default();
                let leaderboard = bounty_boards::build_leaderboard(&state.pool, a.id).await.unwrap_or_default();
                Some(bounty_boards::ActiveBountyBoardPayload {
                    id:                            a.id,
                    title:                         a.title.clone(),
                    status:                        if a.paused { "paused".into() } else { "running".into() },
                    coord_broadcast_interval_secs: a.coord_broadcast_interval_secs,
                    coord_broadcast_threshold:     a.coord_broadcast_threshold,
                    reward_interval_secs:          a.reward_interval_secs,
                    reward_items_json:             a.reward_items_json.clone(),
                    rising_oceans_id:              a.rising_oceans_id,
                    world_slug:                    a.world_slug.clone(),
                    created_by:                    a.created_by.clone(),
                    tracked_stats:                 stats,
                    leaderboard,
                })
            }
        }
    };

    Ok(Json(bounty_boards::BountyBoardStatePayload { active, recent }))
}

// ── GET /api/events/bounty-board/stream ─────────────────────────────────────

pub async fn stream(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<impl IntoResponse> {
    crate::auth::middleware::require_perm(&actor, "nav.events")?;

    let rx = state.bounty_board_tx.subscribe();
    let broadcast_stream = BroadcastStream::new(rx);

    let sse_stream = broadcast_stream.filter_map(
        |result| -> Option<std::result::Result<Event, std::convert::Infallible>> {
            match result {
                Ok(payload) => match serde_json::to_string(&*payload) {
                    Ok(json) => Some(Ok(Event::default().data(json))),
                    Err(e) => {
                        warn!("bounty_board SSE: serialize error: {e}");
                        None
                    }
                },
                Err(e) => {
                    let n = match e {
                        tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(n) => n,
                    };
                    warn!("bounty_board SSE: client lagged by {n} messages");
                    None
                }
            }
        },
    );

    Ok(Sse::new(sse_stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text(":keepalive"),
    ))
}

// ── POST /api/events/bounty-board ───────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateBody {
    pub title: String,
    #[serde(default = "default_coord_interval")]
    pub coord_broadcast_interval_secs: i64,
    #[serde(default = "default_coord_threshold")]
    pub coord_broadcast_threshold: i64,
    #[serde(default = "default_reward_interval")]
    pub reward_interval_secs: i64,
    #[serde(default = "default_reward_items")]
    pub reward_items_json: String,
    pub rising_oceans_id: Option<i64>,
}

fn default_coord_interval() -> i64 { 300 }
fn default_coord_threshold() -> i64 { 10 }
fn default_reward_interval() -> i64 { 600 }
fn default_reward_items() -> String { r#"["minecraft:diamond 3"]"#.into() }

pub async fn create(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<CreateBody>,
) -> Result<Json<bounty_boards::BountyBoard>> {
    crate::auth::middleware::require_perm(&actor, "events.bounty_board.manage")?;

    // Validate
    if body.title.trim().is_empty() || body.title.len() > 100 {
        return Err(AppError::BadRequest("title must be 1–100 characters".into()));
    }
    if body.coord_broadcast_interval_secs < 60 {
        return Err(AppError::BadRequest("coord broadcast interval must be at least 60 seconds".into()));
    }
    if body.reward_interval_secs < 60 {
        return Err(AppError::BadRequest("reward interval must be at least 60 seconds".into()));
    }

    // Validate reward items JSON
    let _items: Vec<String> = serde_json::from_str(&body.reward_items_json)
        .map_err(|_| AppError::BadRequest("reward_items_json must be a JSON array of strings".into()))?;

    // Validate rising_oceans_id if provided
    if let Some(ro_id) = body.rising_oceans_id {
        let ro = crate::db::rising_oceans::get(&state.pool, ro_id).await?;
        if ro.is_none() {
            return Err(AppError::BadRequest(format!("Rising Oceans event {ro_id} not found")));
        }
    }

    let world = worlds::get_active(&state.pool)
        .await?
        .ok_or_else(|| AppError::BadRequest("No active world found".into()))?;

    let row = bounty_boards::create(
        &state.pool,
        body.title.trim(),
        body.coord_broadcast_interval_secs,
        body.coord_broadcast_threshold,
        body.reward_interval_secs,
        &body.reward_items_json,
        body.rising_oceans_id,
        &world.slug,
        &actor.email,
    )
    .await?;

    Ok(Json(row))
}

// ── POST /api/events/bounty-board/:id/start ─────────────────────────────────

pub async fn start(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.bounty_board.manage")?;

    // Enforce single active
    {
        let guard = state.bounty_board_active.lock().await;
        if guard.is_some() {
            return Err(AppError::Conflict("Another Bounty Board is already active".into()));
        }
    }

    let row = bounty_boards::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Bounty Board {id} not found")))?;

    if row.status != "pending" {
        return Err(AppError::BadRequest(format!(
            "Cannot start board in '{}' status", row.status
        )));
    }

    // Capture baselines for all players
    let tracked = bounty_boards::get_tracked_stats(&state.pool, id).await?;
    let all_stats = mc_stats::fetch_all_stats(&state.config).await.map_err(|e| {
        tracing::error!(error = %e, "Failed to fetch player stats for baseline");
        AppError::ExternalCommand(format!("Could not read player stats: {e}"))
    })?;

    for (uuid, (ign, player_stats)) in &all_stats {
        for ts in &tracked {
            let raw = mc_stats::resolve_stat(player_stats, &ts.mc_paths);
            bounty_boards::upsert_baseline(&state.pool, id, uuid, ign, &ts.stat_key, raw).await?;
        }
    }

    bounty_boards::update_status(&state.pool, id, "running").await?;

    // Populate in-memory state
    {
        let now = Instant::now();
        let mut guard = state.bounty_board_active.lock().await;
        *guard = Some(ActiveBountyBoard {
            id:                            row.id,
            title:                         row.title,
            coord_broadcast_interval_secs: row.coord_broadcast_interval_secs,
            coord_broadcast_threshold:     row.coord_broadcast_threshold,
            reward_interval_secs:          row.reward_interval_secs,
            reward_items_json:             row.reward_items_json,
            rising_oceans_id:              row.rising_oceans_id,
            world_slug:                    row.world_slug,
            created_by:                    row.created_by,
            paused:                        false,
            last_poll_at:                  now,
            last_coord_broadcast_at:       now,
            last_reward_at:                now,
            peak_values:                   std::collections::HashMap::new(),
        });
    }

    // Announce to players
    let _ = crate::minecraft::console::send(
        &state.config,
        &format!(
            r#"tellraw @a [{{"text":"[Bounty Board] ","color":"gold","bold":true}},{{"text":"A bounty board event has begun! Your stats are now being tracked.","color":"yellow"}}]"#,
        ),
    ).await;

    crate::minecraft::bounty_runner::broadcast_state(
        &state.pool, &state.bounty_board_active, &state.bounty_board_tx,
    ).await;

    Ok(StatusCode::ACCEPTED)
}

// ── POST /api/events/bounty-board/:id/pause ─────────────────────────────────

pub async fn pause(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.bounty_board.manage")?;

    let mut guard = state.bounty_board_active.lock().await;
    let active = guard
        .as_mut()
        .filter(|a| a.id == id && !a.paused)
        .ok_or_else(|| AppError::BadRequest("No running Bounty Board with that ID".into()))?;

    active.paused = true;
    drop(guard);

    bounty_boards::update_status(&state.pool, id, "paused").await?;
    crate::minecraft::bounty_runner::broadcast_state(
        &state.pool, &state.bounty_board_active, &state.bounty_board_tx,
    ).await;

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/events/bounty-board/:id/resume ────────────────────────────────

pub async fn resume(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.bounty_board.manage")?;

    let mut guard = state.bounty_board_active.lock().await;
    let active = guard
        .as_mut()
        .filter(|a| a.id == id && a.paused)
        .ok_or_else(|| AppError::BadRequest("No paused Bounty Board with that ID".into()))?;

    active.paused = false;
    active.last_poll_at = Instant::now();
    drop(guard);

    bounty_boards::update_status(&state.pool, id, "running").await?;
    crate::minecraft::bounty_runner::broadcast_state(
        &state.pool, &state.bounty_board_active, &state.bounty_board_tx,
    ).await;

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/events/bounty-board/:id/finish ────────────────────────────────

pub async fn finish(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.bounty_board.manage")?;

    {
        let mut guard = state.bounty_board_active.lock().await;
        let _ = guard
            .as_ref()
            .filter(|a| a.id == id)
            .ok_or_else(|| AppError::BadRequest("No active Bounty Board with that ID".into()))?;
        *guard = None;
    }

    bounty_boards::update_status(&state.pool, id, "finished").await?;

    // Announce final results
    let leaderboard = bounty_boards::build_leaderboard(&state.pool, id).await.unwrap_or_default();
    if let Some(winner) = leaderboard.first() {
        let _ = crate::minecraft::console::send(
            &state.config,
            &format!(
                r#"tellraw @a [{{"text":"[Bounty Board] ","color":"gold","bold":true}},{{"text":"The event has ended! Winner: {ign} with a score of {score:.0}!","color":"green"}}]"#,
                ign = winner.player_ign,
                score = winner.total_score,
            ),
        ).await;
    }

    crate::minecraft::bounty_runner::broadcast_state(
        &state.pool, &state.bounty_board_active, &state.bounty_board_tx,
    ).await;

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/events/bounty-board/:id/cancel ────────────────────────────────

pub async fn cancel(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.bounty_board.manage")?;

    {
        let mut guard = state.bounty_board_active.lock().await;
        let _ = guard
            .as_ref()
            .filter(|a| a.id == id)
            .ok_or_else(|| AppError::BadRequest("No active Bounty Board with that ID".into()))?;
        *guard = None;
    }

    bounty_boards::update_status(&state.pool, id, "cancelled").await?;
    crate::minecraft::bounty_runner::broadcast_state(
        &state.pool, &state.bounty_board_active, &state.bounty_board_tx,
    ).await;

    Ok(StatusCode::NO_CONTENT)
}

// ── DELETE /api/events/bounty-board/:id ─────────────────────────────────────

pub async fn delete(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.bounty_board.manage")?;

    let found = bounty_boards::delete(&state.pool, id).await?;
    if !found {
        return Err(AppError::NotFound("Event not found or still active".into()));
    }

    crate::minecraft::bounty_runner::broadcast_state(
        &state.pool, &state.bounty_board_active, &state.bounty_board_tx,
    ).await;

    Ok(StatusCode::NO_CONTENT)
}
