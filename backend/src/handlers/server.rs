use axum::{extract::{Path, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    auth::middleware::AuthUser,
    db::audit,
    error::{AppError, Result},
    gcloud::{instance, ssh},
    minecraft::console::{self, WeatherKind},
    state::AppState,
};

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ServerStatus {
    pub vm:      instance::VmStatus,
    pub service: String,
}

pub async fn status(
    State(state): State<AppState>,
    _: AuthUser,
) -> Result<Json<ServerStatus>> {
    let vm = instance::status(&state.config).await?;
    let service = if vm.status == "RUNNING" {
        ssh::run(&state.config, "systemctl is-active minecraft 2>/dev/null || echo inactive")
            .await
            .map(|(out, _)| out)
            .unwrap_or_else(|_| "unknown".into())
    } else {
        "stopped".into()
    };
    Ok(Json(ServerStatus { vm, service }))
}

/// POST /api/server/vm/:action  (start | stop | reset)
pub async fn vm_action(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(action): Path<String>,
) -> Result<StatusCode> {
    if !actor.can_control_server() {
        return Err(AppError::Forbidden("control_server required".into()));
    }
    match action.as_str() {
        "start" => instance::start(&state.config).await?,
        "stop"  => instance::stop(&state.config).await?,
        "reset" => instance::reset(&state.config).await?,
        _ => return Err(AppError::BadRequest(format!("Unknown action: {action}"))),
    }
    audit::log(&state.pool, &actor.email, "vm_action", None, Some(&action)).await?;
    Ok(StatusCode::ACCEPTED)
}

/// POST /api/server/service/:action  (start | stop | restart)
pub async fn service_action(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(action): Path<String>,
) -> Result<StatusCode> {
    if !actor.can_control_server() {
        return Err(AppError::Forbidden("control_server required".into()));
    }
    let valid = ["start", "stop", "restart"];
    if !valid.contains(&action.as_str()) {
        return Err(AppError::BadRequest(format!("Unknown action: {action}")));
    }
    ssh::run(&state.config, &format!("sudo systemctl {action} minecraft")).await?;
    audit::log(&state.pool, &actor.email, "service_action", None, Some(&action)).await?;
    Ok(StatusCode::ACCEPTED)
}

#[derive(Deserialize)]
pub struct ConsoleBody {
    pub command: String,
}

/// POST /api/console  — send any command to the Minecraft FIFO
pub async fn send_console(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<ConsoleBody>,
) -> Result<Json<serde_json::Value>> {
    if !actor.can_control_server() {
        return Err(AppError::Forbidden("control_server required".into()));
    }
    let applied = console::send(&state.config, &body.command).await?;
    audit::log(&state.pool, &actor.email, "console", None, Some(&body.command)).await?;
    Ok(Json(serde_json::json!({ "applied": applied })))
}

#[derive(Deserialize)]
pub struct GameruleBody { pub value: String }

/// POST /api/world/gamerule/:rule
pub async fn set_gamerule(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(rule): Path<String>,
    Json(body): Json<GameruleBody>,
) -> Result<Json<serde_json::Value>> {
    if !actor.can_control_server() {
        return Err(AppError::Forbidden("control_server required".into()));
    }
    let applied = console::set_gamerule(&state.config, &rule, &body.value).await?;
    Ok(Json(serde_json::json!({ "applied": applied })))
}

#[derive(Deserialize)]
pub struct TimeBody { pub ticks: u32 }

/// POST /api/world/time
pub async fn set_time(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<TimeBody>,
) -> Result<Json<serde_json::Value>> {
    if !actor.can_control_server() {
        return Err(AppError::Forbidden("control_server required".into()));
    }
    let applied = console::set_time(&state.config, body.ticks).await?;
    Ok(Json(serde_json::json!({ "applied": applied })))
}

#[derive(Deserialize)]
pub struct WeatherBody { pub kind: WeatherKind }

/// POST /api/world/weather
pub async fn set_weather(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<WeatherBody>,
) -> Result<Json<serde_json::Value>> {
    if !actor.can_control_server() {
        return Err(AppError::Forbidden("control_server required".into()));
    }
    let applied = console::set_weather(&state.config, body.kind).await?;
    Ok(Json(serde_json::json!({ "applied": applied })))
}
