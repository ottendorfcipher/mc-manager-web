use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;

use crate::{
    auth::middleware::AuthUser,
    db::map_pins,
    error::{AppError, Result},
    state::AppState,
};

/// GET /api/map/pins  — list pins visible to the caller
pub async fn list(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<Vec<map_pins::MapPin>>> {
    Ok(Json(map_pins::list(&state.pool, &actor.email).await?))
}

#[derive(Deserialize)]
pub struct CreatePin {
    pub x: f64,
    pub z: f64,
    #[serde(default = "default_overworld")]
    pub dimension: String,
    pub label: String,
    pub body: Option<String>,
    #[serde(default = "default_icon")]
    pub icon: String,
    #[serde(default = "default_private")]
    pub visibility: String,
}

fn default_overworld() -> String {
    "minecraft:overworld".into()
}
fn default_icon() -> String {
    "default".into()
}
fn default_private() -> String {
    "private".into()
}

/// POST /api/map/pins
pub async fn create(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<CreatePin>,
) -> Result<(StatusCode, Json<map_pins::MapPin>)> {
    crate::auth::middleware::require_perm(&actor, "map.pin.create")?;

    validate_visibility(&body.visibility)?;

    let id = map_pins::insert(
        &state.pool,
        body.x,
        body.z,
        &body.dimension,
        &body.label,
        body.body.as_deref(),
        &body.icon,
        &body.visibility,
        &actor.email,
    )
    .await?;

    let pin = map_pins::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("insert failed")))?;

    Ok((StatusCode::CREATED, Json(pin)))
}

#[derive(Deserialize)]
pub struct UpdatePin {
    pub label: String,
    pub body: Option<String>,
    #[serde(default = "default_icon")]
    pub icon: String,
    pub visibility: String,
}

/// PATCH /api/map/pins/:id
pub async fn update(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
    Json(body): Json<UpdatePin>,
) -> Result<Json<map_pins::MapPin>> {
    let pin = map_pins::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Pin {id} not found")))?;

    can_modify(&actor, &pin)?;
    validate_visibility(&body.visibility)?;

    map_pins::update(
        &state.pool,
        id,
        &body.label,
        body.body.as_deref(),
        &body.icon,
        &body.visibility,
    )
    .await?;

    let updated = map_pins::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("update failed")))?;
    Ok(Json(updated))
}

/// DELETE /api/map/pins/:id
pub async fn delete(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    let pin = map_pins::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Pin {id} not found")))?;

    can_modify(&actor, &pin)?;
    map_pins::delete(&state.pool, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn can_modify(actor: &AuthUser, pin: &map_pins::MapPin) -> Result<()> {
    if pin.created_by == actor.email {
        return Ok(());
    }
    if actor.permissions.contains("map.pin.manage") {
        return Ok(());
    }
    Err(AppError::Forbidden(
        "Cannot modify another user's pin".into(),
    ))
}

fn validate_visibility(v: &str) -> Result<()> {
    if v == "private" || v == "team" {
        return Ok(());
    }
    Err(AppError::BadRequest(format!(
        "visibility must be 'private' or 'team', got '{v}'"
    )))
}
