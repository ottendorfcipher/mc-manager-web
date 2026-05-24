//! Handlers for the Events feature — starting with countdowns.

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
    db::countdowns::{self, CountdownStatePayload},
    error::{AppError, Result},
    minecraft::{
        countdown as mc,
        countdown_runner::{self, ActiveCountdown},
    },
    state::AppState,
};

const BOSSBAR_ID: &str = "rsc:countdown";

// ── GET /api/events/countdowns ─────────────────────────────────────────────────

pub async fn list(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<Vec<countdowns::Countdown>>> {
    crate::auth::middleware::require_perm(&actor, "nav.events")?;
    let rows = countdowns::list_recent(&state.pool, 20).await?;
    Ok(Json(rows))
}

// ── GET /api/events/countdowns/state ───────────────────────────────────────────

pub async fn get_state(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<CountdownStatePayload>> {
    crate::auth::middleware::require_perm(&actor, "nav.events")?;

    let recent = countdowns::list_recent(&state.pool, 20).await?;
    let active = {
        let guard = state.countdown_active.lock().await;
        guard.as_ref().map(|a| countdowns::ActiveCountdownPayload {
            id:             a.id,
            title:          a.title.clone(),
            duration_secs:  a.duration_secs,
            remaining_secs: a.remaining_secs(),
            target:         a.target.clone(),
            display_mode:   a.display_mode.clone(),
            color:          a.color.clone(),
            sound_id:       a.sound_id.clone(),
            status:         if a.paused { "paused".into() } else { "running".into() },
            created_by:     a.created_by.clone(),
        })
    };

    Ok(Json(CountdownStatePayload { active, recent }))
}

// ── GET /api/events/countdowns/stream ──────────────────────────────────────────

pub async fn stream(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<impl IntoResponse> {
    crate::auth::middleware::require_perm(&actor, "nav.events")?;

    let rx = state.countdown_tx.subscribe();
    let broadcast_stream = BroadcastStream::new(rx);

    let sse_stream = broadcast_stream.filter_map(
        |result| -> Option<std::result::Result<Event, std::convert::Infallible>> {
            match result {
                Ok(payload) => match serde_json::to_string(&*payload) {
                    Ok(json) => Some(Ok(Event::default().data(json))),
                    Err(e) => {
                        warn!("countdown SSE: serialize error: {e}");
                        None
                    }
                },
                Err(e) => {
                    let n = match e {
                        tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(n) => n,
                    };
                    warn!("countdown SSE: client lagged by {n} events");
                    Some(Ok(Event::default()
                        .event("lagged")
                        .data(format!("{{\"missed\":{n}}}"))))
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

// ── POST /api/events/countdowns ────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateCountdownBody {
    pub title:        String,
    pub duration_secs: i64,
    #[serde(default = "default_target")]
    pub target:       String,
    #[serde(default = "default_display_mode")]
    pub display_mode: String,
    #[serde(default = "default_color")]
    pub color:        String,
    pub sound_id:     Option<String>,
    #[serde(default = "default_auto_start")]
    pub auto_start:   bool,
}

fn default_target()       -> String { "@a".into() }
fn default_display_mode() -> String { "actionbar,title_final".into() }
fn default_color()        -> String { "yellow".into() }
fn default_auto_start()   -> bool   { true }

pub async fn create(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<CreateCountdownBody>,
) -> Result<(StatusCode, Json<countdowns::Countdown>)> {
    crate::auth::middleware::require_perm(&actor, "events.countdown.create")?;

    // Validate
    let title = body.title.trim();
    if title.is_empty() || title.len() > 60 {
        return Err(AppError::BadRequest("Title must be 1–60 characters".into()));
    }
    if body.duration_secs < 1 || body.duration_secs > 3600 {
        return Err(AppError::BadRequest("Duration must be 1–3600 seconds".into()));
    }

    let row = countdowns::create(
        &state.pool,
        title,
        body.duration_secs,
        &body.target,
        &body.display_mode,
        &body.color,
        body.sound_id.as_deref(),
        &actor.email,
    )
    .await?;

    if body.auto_start {
        do_start(&state, row.id, &actor.email).await?;
    }

    countdown_runner::broadcast_state(&state.pool, &state.countdown_active, &state.countdown_tx)
        .await;

    Ok((StatusCode::CREATED, Json(row)))
}

// ── POST /api/events/countdowns/:id/start ──────────────────────────────────────

pub async fn start(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.countdown.create")?;
    do_start(&state, id, &actor.email).await?;
    countdown_runner::broadcast_state(&state.pool, &state.countdown_active, &state.countdown_tx)
        .await;
    Ok(StatusCode::NO_CONTENT)
}

async fn do_start(state: &AppState, id: i64, _actor: &str) -> Result<()> {
    // Check no other countdown is active
    {
        let guard = state.countdown_active.lock().await;
        if guard.is_some() {
            return Err(AppError::Conflict(
                "Another countdown is already running".into(),
            ));
        }
    }

    let row = countdowns::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Countdown {id} not found")))?;

    if row.status != "pending" {
        return Err(AppError::BadRequest(format!(
            "Cannot start a countdown with status '{}'",
            row.status
        )));
    }

    // Update DB
    countdowns::update_status(&state.pool, id, "running", 0).await?;

    // Set up bossbar if needed
    let display_mode = &row.display_mode;
    if display_mode.contains("bossbar") {
        let name = mc::format_countdown_text(&row.title, row.duration_secs, &row.color);
        let _ = mc::bossbar_add(&state.config, BOSSBAR_ID, &name).await;
        let _ = mc::bossbar_set_players(&state.config, BOSSBAR_ID, &row.target).await;
        let _ = mc::bossbar_set_max(&state.config, BOSSBAR_ID, row.duration_secs as u32).await;
        let _ = mc::bossbar_set_value(&state.config, BOSSBAR_ID, row.duration_secs as u32).await;
        let _ = mc::bossbar_set_color(&state.config, BOSSBAR_ID, &row.color).await;
        let _ = mc::bossbar_set_visible(&state.config, BOSSBAR_ID, true).await;
    }

    // Set title times for actionbar persistence
    let _ = mc::set_title_times(&state.config, &row.target, 0, 25, 5).await;

    // Set in-memory state
    {
        let mut guard = state.countdown_active.lock().await;
        *guard = Some(ActiveCountdown {
            id,
            title:                row.title,
            duration_secs:        row.duration_secs,
            target:               row.target,
            display_mode:         row.display_mode,
            color:                row.color,
            sound_id:             row.sound_id,
            created_by:           row.created_by,
            elapsed_before_resume: 0,
            resumed_at:           Instant::now(),
            paused:               false,
        });
    }

    Ok(())
}

// ── POST /api/events/countdowns/:id/pause ──────────────────────────────────────

pub async fn pause(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.countdown.manage")?;

    let mut guard = state.countdown_active.lock().await;
    let active = guard
        .as_mut()
        .filter(|a| a.id == id && !a.paused)
        .ok_or_else(|| AppError::BadRequest("No running countdown with that ID".into()))?;

    // Freeze elapsed time
    active.elapsed_before_resume += active.resumed_at.elapsed().as_secs() as i64;
    active.paused = true;

    let elapsed = active.elapsed_before_resume;
    drop(guard);

    countdowns::update_status(&state.pool, id, "paused", elapsed).await?;
    countdown_runner::broadcast_state(&state.pool, &state.countdown_active, &state.countdown_tx)
        .await;

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/events/countdowns/:id/resume ─────────────────────────────────────

pub async fn resume(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.countdown.manage")?;

    let mut guard = state.countdown_active.lock().await;
    let active = guard
        .as_mut()
        .filter(|a| a.id == id && a.paused)
        .ok_or_else(|| AppError::BadRequest("No paused countdown with that ID".into()))?;

    active.resumed_at = Instant::now();
    active.paused = false;
    drop(guard);

    countdowns::update_status(&state.pool, id, "running", 0).await?;
    countdown_runner::broadcast_state(&state.pool, &state.countdown_active, &state.countdown_tx)
        .await;

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/events/countdowns/:id/cancel ─────────────────────────────────────

pub async fn cancel(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.countdown.manage")?;

    let mut guard = state.countdown_active.lock().await;
    let matched = guard.as_ref().map(|a| a.id == id).unwrap_or(false);

    if matched {
        let a = guard.as_ref().unwrap();
        let elapsed = a.total_elapsed();
        let target = a.target.clone();
        let has_bossbar = a.has_mode("bossbar");
        *guard = None;
        drop(guard);

        // Clean up MC displays
        if has_bossbar {
            let _ = mc::bossbar_remove(&state.config, BOSSBAR_ID).await;
        }
        let _ = mc::clear_title(&state.config, &target).await;

        countdowns::update_status(&state.pool, id, "cancelled", elapsed).await?;
    } else {
        drop(guard);
        // Allow cancelling a pending countdown too
        let row = countdowns::get(&state.pool, id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Countdown {id} not found")))?;
        if row.status != "pending" {
            return Err(AppError::BadRequest("Countdown is not active or pending".into()));
        }
        countdowns::update_status(&state.pool, id, "cancelled", 0).await?;
    }

    countdown_runner::broadcast_state(&state.pool, &state.countdown_active, &state.countdown_tx)
        .await;

    Ok(StatusCode::NO_CONTENT)
}

// ── DELETE /api/events/countdowns/:id ──────────────────────────────────────────

pub async fn delete(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.countdown.manage")?;

    let found = countdowns::delete(&state.pool, id).await?;
    if !found {
        return Err(AppError::NotFound(
            "Countdown not found or cannot be deleted (must be finished/cancelled/pending)".into(),
        ));
    }

    countdown_runner::broadcast_state(&state.pool, &state.countdown_active, &state.countdown_tx)
        .await;

    Ok(StatusCode::NO_CONTENT)
}
