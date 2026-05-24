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
    db::{
        backups,
        rising_oceans::{self, RisingOceanStatePayload},
        worlds,
    },
    error::{AppError, Result},
    minecraft::{
        console,
        rising_oceans_runner::{self, ActiveRisingOcean},
        world_switch,
    },
    state::AppState,
};

// ── GET /api/events/rising-oceans/state ──────────────────────────────────────

pub async fn get_state(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<RisingOceanStatePayload>> {
    crate::auth::middleware::require_perm(&actor, "nav.events")?;

    let recent = rising_oceans::list_recent(&state.pool, 20).await?;
    let active = {
        let guard = state.rising_oceans_active.lock().await;
        guard.as_ref().map(|a| rising_oceans::ActiveRisingOceanPayload {
            id:                a.id,
            status:            if a.paused { "paused".into() } else { "running".into() },
            center_x:          a.center_x,
            center_z:          a.center_z,
            radius:            a.radius,
            start_y:           a.start_y,
            end_y:             a.end_y,
            current_y:         a.current_y,
            interval_secs:     a.interval_secs,
            blocks_per_step:   a.blocks_per_step,
            perimeter_enforce: if a.perimeter_enforce { 1 } else { 0 },
            rise_pattern_json: if a.rise_pattern.is_empty() {
                None
            } else {
                serde_json::to_string(&a.rise_pattern).ok()
            },
            backup_id:         a.backup_id,
            world_slug:        a.world_slug.clone(),
            created_by:        a.created_by.clone(),
        })
    };

    Ok(Json(RisingOceanStatePayload { active, recent }))
}

// ── GET /api/events/rising-oceans/stream ─────────────────────────────────────

pub async fn stream(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<impl IntoResponse> {
    crate::auth::middleware::require_perm(&actor, "nav.events")?;

    let rx = state.rising_oceans_tx.subscribe();
    let broadcast_stream = BroadcastStream::new(rx);

    let sse_stream = broadcast_stream.filter_map(
        |result| -> Option<std::result::Result<Event, std::convert::Infallible>> {
            match result {
                Ok(payload) => match serde_json::to_string(&*payload) {
                    Ok(json) => Some(Ok(Event::default().data(json))),
                    Err(e) => {
                        warn!("rising_oceans SSE: serialize error: {e}");
                        None
                    }
                },
                Err(e) => {
                    let n = match e {
                        tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(n) => n,
                    };
                    warn!("rising_oceans SSE: client lagged by {n} messages");
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

// ── POST /api/events/rising-oceans ───────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateBody {
    #[serde(default)]
    pub center_x: i64,
    #[serde(default)]
    pub center_z: i64,
    #[serde(default = "default_radius")]
    pub radius: i64,
    #[serde(default = "default_start_y")]
    pub start_y: i64,
    #[serde(default = "default_end_y")]
    pub end_y: i64,
    #[serde(default = "default_interval")]
    pub interval_secs: i64,
    /// How many Y levels are filled per interval tick (default 1).
    /// Ignored when `rise_pattern` is provided.
    #[serde(default = "default_blocks_per_step")]
    pub blocks_per_step: i64,
    /// When true, players are pushed back inside the radius each tick.
    #[serde(default = "default_perimeter_enforce")]
    pub perimeter_enforce: bool,
    /// Optional explicit schedule.  Array of `interval_secs` values, one per
    /// step (each step still rises 1 block).  When set, overrides start_y/end_y
    /// length: the event runs exactly `rise_pattern.len()` steps starting from
    /// `start_y + 1`.
    #[serde(default)]
    pub rise_pattern: Option<Vec<i64>>,
}

fn default_radius() -> i64 { 256 }
fn default_start_y() -> i64 { 64 }
fn default_end_y() -> i64 { 100 }
fn default_interval() -> i64 { 30 }
fn default_blocks_per_step() -> i64 { 1 }
fn default_perimeter_enforce() -> bool { true }

/// 90 days in seconds.
const MAX_EVENT_DURATION_SECS: i64 = 90 * 24 * 3600;

pub async fn create(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<CreateBody>,
) -> Result<Json<rising_oceans::RisingOcean>> {
    crate::auth::middleware::require_perm(&actor, "events.rising_oceans.manage")?;

    // Validate
    if body.radius < 16 || body.radius > 1024 {
        return Err(AppError::BadRequest("radius must be 16–1024".into()));
    }
    if body.start_y < -64 || body.start_y > 319 {
        return Err(AppError::BadRequest("start_y must be -64 to 319".into()));
    }
    if body.end_y <= body.start_y || body.end_y > 319 {
        return Err(AppError::BadRequest("end_y must be greater than start_y and at most 319".into()));
    }
    if body.interval_secs < 5 {
        return Err(AppError::BadRequest("interval must be at least 5 seconds".into()));
    }
    if body.blocks_per_step < 1 || body.blocks_per_step > 64 {
        return Err(AppError::BadRequest("blocks_per_step must be 1–64".into()));
    }

    // Validate rise_pattern if present
    if let Some(ref pat) = body.rise_pattern {
        if pat.is_empty() || pat.len() > 1000 {
            return Err(AppError::BadRequest("rise_pattern must contain 1–1000 entries".into()));
        }
        for (i, v) in pat.iter().enumerate() {
            if *v < 1 || *v > 3600 {
                return Err(AppError::BadRequest(format!(
                    "rise_pattern[{i}] = {v} is out of range (1–3600 seconds)"
                )));
            }
        }
    }

    // Total-duration check
    let (total_levels, total_duration) = if let Some(ref pat) = body.rise_pattern {
        let dur: i64 = pat.iter().sum();
        (pat.len() as i64, dur)
    } else {
        let levels = (body.end_y - body.start_y).max(0);
        let steps = ((levels + body.blocks_per_step - 1) / body.blocks_per_step).max(0);
        (levels, steps.saturating_mul(body.interval_secs))
    };
    if total_duration > MAX_EVENT_DURATION_SECS {
        let max_days = MAX_EVENT_DURATION_SECS / 86400;
        return Err(AppError::BadRequest(format!(
            "Total event duration ({total_levels} levels, {total_duration}s) exceeds the {max_days}-day maximum"
        )));
    }

    // Determine current active world
    let world = worlds::get_active(&state.pool)
        .await?
        .ok_or_else(|| AppError::BadRequest("No active world found".into()))?;

    let pattern_json = body.rise_pattern.as_ref().map(|p| serde_json::to_string(p).unwrap_or_default());

    let row = rising_oceans::create(
        &state.pool,
        body.center_x,
        body.center_z,
        body.radius,
        body.start_y,
        body.end_y,
        body.interval_secs,
        body.blocks_per_step,
        body.perimeter_enforce,
        pattern_json.as_deref(),
        &world.slug,
        &actor.email,
    )
    .await?;

    Ok(Json(row))
}

// ── POST /api/events/rising-oceans/:id/start ─────────────────────────────────

pub async fn start(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.rising_oceans.manage")?;
    do_start(&state, id).await?;
    Ok(StatusCode::ACCEPTED)
}

/// Permission-free start helper.  Callable from other handlers/runners
/// (e.g. the lobby launch ceremony) that have already done their own auth.
pub async fn do_start(state: &AppState, id: i64) -> Result<()> {
    // Enforce single active
    {
        let guard = state.rising_oceans_active.lock().await;
        if guard.is_some() {
            return Err(AppError::Conflict(
                "Another Rising Oceans event is already active".into(),
            ));
        }
    }

    let row = rising_oceans::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Rising Oceans event {id} not found")))?;

    if row.status != "pending" {
        return Err(AppError::BadRequest(format!(
            "Cannot start event in '{}' status", row.status
        )));
    }

    // ── Create pre-event backup ──────────────────────────────────────────────
    let backup_remote_path = world_switch::create_world_backup(&state.config, &row.world_slug)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to create pre-event backup");
            AppError::ExternalCommand(format!("Pre-event backup failed: {e}"))
        })?;

    // Sync backup into DB so we have a record
    let world = worlds::get_active(&state.pool).await?.ok_or_else(|| {
        AppError::Internal(anyhow::anyhow!("Active world disappeared"))
    })?;
    crate::minecraft::backup::sync_world_backup_into_db(
        &state.pool, &state.config, world.id, &world.slug,
    ).await;

    // Find the backup record by matching the path
    let filename = backup_remote_path
        .rsplit('/')
        .next()
        .unwrap_or(&backup_remote_path);
    let backup_record = backups::get_by_filename(&state.pool, filename).await?;
    let backup_id = backup_record.as_ref().map(|b| b.id).unwrap_or(0);

    rising_oceans::set_backup(&state.pool, id, backup_id, &backup_remote_path).await?;
    rising_oceans::update_status(&state.pool, id, "running").await?;

    // ── Set worldborder for hard square containment (perimeter shield) ──────
    if row.perimeter_enforce == 1 {
        // worldborder set <diameter> <time-secs>
        let diameter = (row.radius * 2).max(16);
        let _ = console::send(
            &state.config,
            &format!("worldborder center {} {}", row.center_x, row.center_z),
        ).await;
        let _ = console::send(
            &state.config,
            &format!("worldborder set {diameter}"),
        ).await;
        let _ = console::send(
            &state.config,
            "worldborder damage buffer 0",
        ).await;
        let _ = console::send(
            &state.config,
            "worldborder damage amount 1",
        ).await;
    }

    // Parse rise_pattern_json
    let rise_pattern: Vec<i64> = row.rise_pattern_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    // Populate in-memory state
    {
        let mut guard = state.rising_oceans_active.lock().await;
        *guard = Some(ActiveRisingOcean {
            id:                row.id,
            center_x:          row.center_x,
            center_z:          row.center_z,
            radius:            row.radius,
            start_y:           row.start_y,
            end_y:             row.end_y,
            current_y:         row.start_y,
            interval_secs:     row.interval_secs,
            blocks_per_step:   row.blocks_per_step,
            perimeter_enforce: row.perimeter_enforce == 1,
            rise_pattern,
            step_idx:          0,
            backup_id:         Some(backup_id),
            world_slug:        row.world_slug.clone(),
            created_by:        row.created_by.clone(),
            paused:            false,
            last_tick_at:      Instant::now(),
            last_perimeter_sweep: Instant::now(),
        });
    }

    rising_oceans_runner::broadcast_state(
        &state.pool, &state.rising_oceans_active, &state.rising_oceans_tx,
    ).await;

    Ok(())
}

// ── POST /api/events/rising-oceans/:id/pause ─────────────────────────────────

pub async fn pause(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.rising_oceans.manage")?;

    let mut guard = state.rising_oceans_active.lock().await;
    let active = guard
        .as_mut()
        .filter(|a| a.id == id && !a.paused)
        .ok_or_else(|| AppError::BadRequest("No running Rising Oceans event with that ID".into()))?;

    active.paused = true;
    drop(guard);

    rising_oceans::update_status(&state.pool, id, "paused").await?;
    rising_oceans_runner::broadcast_state(
        &state.pool, &state.rising_oceans_active, &state.rising_oceans_tx,
    ).await;

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/events/rising-oceans/:id/resume ────────────────────────────────

pub async fn resume(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.rising_oceans.manage")?;

    let mut guard = state.rising_oceans_active.lock().await;
    let active = guard
        .as_mut()
        .filter(|a| a.id == id && a.paused)
        .ok_or_else(|| AppError::BadRequest("No paused Rising Oceans event with that ID".into()))?;

    active.paused = false;
    active.last_tick_at = Instant::now();
    drop(guard);

    rising_oceans::update_status(&state.pool, id, "running").await?;
    rising_oceans_runner::broadcast_state(
        &state.pool, &state.rising_oceans_active, &state.rising_oceans_tx,
    ).await;

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/events/rising-oceans/:id/cancel ────────────────────────────────

pub async fn cancel(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.rising_oceans.manage")?;

    let perimeter_was_on = {
        let mut guard = state.rising_oceans_active.lock().await;
        let was_on = guard
            .as_ref()
            .filter(|a| a.id == id)
            .map(|a| a.perimeter_enforce)
            .ok_or_else(|| AppError::BadRequest("No active Rising Oceans event with that ID".into()))?;
        *guard = None;
        was_on
    };

    // Reset worldborder to default size if perimeter was active
    if perimeter_was_on {
        let _ = console::send(&state.config, "worldborder set 60000000").await;
    }

    rising_oceans::update_status(&state.pool, id, "cancelled").await?;
    rising_oceans_runner::broadcast_state(
        &state.pool, &state.rising_oceans_active, &state.rising_oceans_tx,
    ).await;

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/events/rising-oceans/:id/revert ────────────────────────────────

pub async fn revert(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.rising_oceans.manage")?;

    let row = rising_oceans::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Rising Oceans event {id} not found")))?;

    if !["finished", "cancelled"].contains(&row.status.as_str()) {
        return Err(AppError::BadRequest(
            "Can only revert a finished or cancelled event".into(),
        ));
    }
    if row.reverted == Some(1) {
        return Err(AppError::BadRequest("Already reverted".into()));
    }

    let backup_path = row.backup_path.as_deref().ok_or_else(|| {
        AppError::BadRequest("No pre-event backup found for this event".into())
    })?;

    // Restore the backup (stops MC, extracts archive, restarts MC)
    world_switch::restore_world_backup(&state.config, backup_path).await?;

    rising_oceans::set_reverted(&state.pool, id, true).await?;
    rising_oceans_runner::broadcast_state(
        &state.pool, &state.rising_oceans_active, &state.rising_oceans_tx,
    ).await;

    Ok(StatusCode::ACCEPTED)
}

// ── POST /api/events/rising-oceans/:id/keep ──────────────────────────────────

pub async fn keep(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.rising_oceans.manage")?;

    let row = rising_oceans::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Rising Oceans event {id} not found")))?;

    if !["finished", "cancelled"].contains(&row.status.as_str()) {
        return Err(AppError::BadRequest(
            "Can only keep/dismiss a finished or cancelled event".into(),
        ));
    }

    rising_oceans::set_reverted(&state.pool, id, false).await?;
    rising_oceans_runner::broadcast_state(
        &state.pool, &state.rising_oceans_active, &state.rising_oceans_tx,
    ).await;

    Ok(StatusCode::NO_CONTENT)
}

// ── DELETE /api/events/rising-oceans/:id ──────────────────────────────────────

pub async fn delete(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "events.rising_oceans.manage")?;

    let found = rising_oceans::delete(&state.pool, id).await?;
    if !found {
        return Err(AppError::NotFound("Event not found or still active".into()));
    }

    rising_oceans_runner::broadcast_state(
        &state.pool, &state.rising_oceans_active, &state.rising_oceans_tx,
    ).await;

    Ok(StatusCode::NO_CONTENT)
}
