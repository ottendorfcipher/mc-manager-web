//! REST handlers for scheduled jobs.
//!
//! Permission: `server.schedule.manage` (admins).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;

use crate::{
    auth::middleware::AuthUser,
    db::scheduled_jobs,
    error::{AppError, Result},
    minecraft::cron::Cron,
    state::AppState,
};

// ── GET /api/scheduled-jobs ───────────────────────────────────────────────────

pub async fn list(
    State(state): State<AppState>,
    actor:        AuthUser,
) -> Result<Json<Vec<scheduled_jobs::ScheduledJob>>> {
    crate::auth::middleware::require_perm(&actor, "nav.automations")?;
    Ok(Json(scheduled_jobs::list(&state.pool).await?))
}

// ── POST /api/scheduled-jobs ──────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateBody {
    pub name:           String,
    pub cron_expr:      String,
    pub action_type:    String,
    #[serde(default)]
    pub action_payload: Option<serde_json::Value>,
}

fn validate(body: &CreateBody) -> Result<Cron> {
    let name = body.name.trim();
    if name.is_empty() || name.len() > 60 {
        return Err(AppError::BadRequest("Name must be 1–60 characters".into()));
    }
    let cron = Cron::parse(body.cron_expr.trim())
        .map_err(|e| AppError::BadRequest(format!("Invalid cron expression: {e}")))?;
    let valid_types = ["console", "announce", "discord", "backup", "countdown"];
    if !valid_types.contains(&body.action_type.as_str()) {
        return Err(AppError::BadRequest(format!(
            "action_type must be one of: {}", valid_types.join(", "),
        )));
    }
    Ok(cron)
}

pub async fn create(
    State(state): State<AppState>,
    actor:        AuthUser,
    Json(body):   Json<CreateBody>,
) -> Result<(StatusCode, Json<scheduled_jobs::ScheduledJob>)> {
    crate::auth::middleware::require_perm(&actor, "server.schedule.manage")?;
    let cron = validate(&body)?;

    let payload_str = body.action_payload
        .as_ref()
        .map(|v| v.to_string())
        .unwrap_or_else(|| "{}".into());

    let next = cron.next_after(chrono::Utc::now())
        .ok_or_else(|| AppError::BadRequest("Cron has no future match in 5 years".into()))?
        .format("%Y-%m-%dT%H:%M:%SZ").to_string();

    let row = scheduled_jobs::create(
        &state.pool,
        body.name.trim(),
        body.cron_expr.trim(),
        &body.action_type,
        &payload_str,
        &next,
        &actor.email,
    ).await?;

    Ok((StatusCode::CREATED, Json(row)))
}

// ── PATCH /api/scheduled-jobs/:id ─────────────────────────────────────────────

#[derive(Deserialize)]
pub struct UpdateBody {
    pub name:           String,
    pub cron_expr:      String,
    pub action_type:    String,
    pub action_payload: Option<serde_json::Value>,
    pub enabled:        bool,
}

pub async fn update(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(id):     Path<i64>,
    Json(body):   Json<UpdateBody>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "server.schedule.manage")?;
    let create_body = CreateBody {
        name:           body.name.clone(),
        cron_expr:      body.cron_expr.clone(),
        action_type:    body.action_type.clone(),
        action_payload: body.action_payload.clone(),
    };
    let cron = validate(&create_body)?;

    let payload_str = body.action_payload
        .as_ref()
        .map(|v| v.to_string())
        .unwrap_or_else(|| "{}".into());

    let next = cron.next_after(chrono::Utc::now())
        .map(|t| t.format("%Y-%m-%dT%H:%M:%SZ").to_string());

    let ok = scheduled_jobs::update(
        &state.pool,
        id,
        body.name.trim(),
        body.cron_expr.trim(),
        &body.action_type,
        &payload_str,
        next.as_deref(),
        body.enabled,
    ).await?;
    if !ok {
        return Err(AppError::NotFound(format!("Job {id} not found")));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ── DELETE /api/scheduled-jobs/:id ────────────────────────────────────────────

pub async fn delete(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(id):     Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "server.schedule.manage")?;
    let ok = scheduled_jobs::delete(&state.pool, id).await?;
    if !ok {
        return Err(AppError::NotFound(format!("Job {id} not found")));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/scheduled-jobs/:id/run ──────────────────────────────────────────
//
// Manual fire-now button.  Useful for testing a job before letting cron pick
// it up.  Doesn't change next_fire_at.

pub async fn run_now(
    State(state): State<AppState>,
    actor:        AuthUser,
    Path(id):     Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "server.schedule.manage")?;
    let job = scheduled_jobs::get(&state.pool, id).await?
        .ok_or_else(|| AppError::NotFound(format!("Job {id} not found")))?;
    // Run inline (synchronous from the caller's perspective).
    crate::minecraft::scheduled_runner::run_job_inline(&state, &job).await
        .map_err(|e| AppError::ExternalCommand(format!("Job failed: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}
