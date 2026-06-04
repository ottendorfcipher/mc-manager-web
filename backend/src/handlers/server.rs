use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    auth::middleware::AuthUser,
    db::{audit, world_gamerules},
    error::{AppError, Result},
    gcloud::{instance, ssh},
    minecraft::console::{self, WeatherKind},
    state::AppState,
};

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct ServerStatus {
    pub vm: instance::VmStatus,
    pub service: String,
}

pub async fn status(State(state): State<AppState>, _: AuthUser) -> Result<Json<ServerStatus>> {
    let vm = instance::status(&state.config).await?;
    let service = if vm.status == "RUNNING" {
        match ssh::run(
            &state.config,
            "systemctl is-active minecraft 2>/dev/null || echo inactive",
        )
        .await
        {
            Ok((out, _)) => out,
            Err(e) => {
                tracing::warn!(error = %e, "SSH to VM failed when checking service status");
                "unknown".into()
            }
        }
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
        "stop" => instance::stop(&state.config).await?,
        "reset" => instance::reset(&state.config).await?,
        _ => return Err(AppError::BadRequest(format!("Unknown action: {action}"))),
    }
    audit::log(&state.pool, &actor.audit_actor(), "vm_action", None, Some(&action)).await?;
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
    audit::log(
        &state.pool,
        &actor.audit_actor(),
        "service_action",
        None,
        Some(&action),
    )
    .await?;
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
    audit::log(
        &state.pool,
        &actor.audit_actor(),
        "console",
        None,
        Some(&body.command),
    )
    .await?;
    Ok(Json(serde_json::json!({ "applied": applied })))
}

#[derive(Deserialize)]
pub struct GameruleBody {
    pub value: String,
}

/// GET /api/world/gamerules — return cached gamerule values from DB.
pub async fn get_gamerules(
    State(state): State<AppState>,
    _: AuthUser,
) -> Result<Json<serde_json::Value>> {
    let entries = world_gamerules::get_all(&state.pool).await?;
    let map: serde_json::Map<String, serde_json::Value> = entries
        .into_iter()
        .map(|e| (e.rule, serde_json::Value::String(e.value)))
        .collect();
    Ok(Json(serde_json::Value::Object(map)))
}

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
    // `difficulty` is a special case: MC uses `/difficulty <level>` not `/gamerule`.
    let applied = if rule == "difficulty" {
        crate::gcloud::ssh::fifo_command(&state.config, &format!("difficulty {}", body.value)).await?
    } else {
        console::set_gamerule(&state.config, &rule, &body.value).await?
    };
    // Persist so the UI can reflect the correct value on next load.
    let _ = world_gamerules::upsert(&state.pool, &rule, &body.value, &actor.email).await;
    Ok(Json(serde_json::json!({ "applied": applied })))
}

#[derive(Deserialize)]
pub struct TimeBody {
    pub ticks: u32,
}

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
pub struct WeatherBody {
    pub kind: WeatherKind,
}

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

// ── Granular Minecraft server commands ────────────────────────────────────────────────
// Each command is gated by its own permission key, enabling fine-grained
// delegation without exposing raw console access.

#[derive(Deserialize)]
pub struct PlayerTargetBody {
    pub player: String,
    pub reason: Option<String>,
}

/// GET /api/server/whitelist  — list current whitelist entries from whitelist.json
#[derive(Debug, Serialize, TS, serde::Deserialize)]
#[ts(export)]
pub struct WhitelistEntry {
    pub uuid: String,
    pub name: String,
}

pub async fn list_whitelist(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<Vec<WhitelistEntry>>> {
    crate::auth::middleware::require_perm(&actor, "server.whitelist.manage")?;
    let (out, _) = ssh::run(
        &state.config,
        "cat /opt/minecraft/server/whitelist.json 2>/dev/null || echo '[]'",
    )
    .await?;
    let entries: Vec<WhitelistEntry> = serde_json::from_str(out.trim()).unwrap_or_default();
    Ok(Json(entries))
}

/// POST /api/server/whitelist/:action  (add | remove)
pub async fn whitelist_action(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(action): Path<String>,
    Json(body): Json<PlayerTargetBody>,
) -> Result<Json<serde_json::Value>> {
    crate::auth::middleware::require_perm(&actor, "server.whitelist.manage")?;
    let cmd = match action.as_str() {
        "add" => format!("whitelist add {}", body.player),
        "remove" => format!("whitelist remove {}", body.player),
        _ => {
            return Err(AppError::BadRequest(format!(
                "Unknown whitelist action: {action}"
            )))
        }
    };
    let applied = console::send(&state.config, &cmd).await?;
    audit::log(
        &state.pool,
        &actor.audit_actor(),
        "whitelist",
        Some(&body.player),
        Some(&action),
    )
    .await?;
    Ok(Json(
        serde_json::json!({ "applied": applied, "action": action, "player": body.player }),
    ))
}

/// POST /api/server/op/:action  (op | deop)
pub async fn op_action(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(action): Path<String>,
    Json(body): Json<PlayerTargetBody>,
) -> Result<Json<serde_json::Value>> {
    crate::auth::middleware::require_perm(&actor, "server.op.manage")?;
    let cmd = match action.as_str() {
        "op" => format!("op {}", body.player),
        "deop" => format!("deop {}", body.player),
        _ => return Err(AppError::BadRequest(format!("Unknown op action: {action}"))),
    };
    let applied = console::send(&state.config, &cmd).await?;
    audit::log(&state.pool, &actor.audit_actor(), &action, Some(&body.player), None).await?;
    Ok(Json(
        serde_json::json!({ "applied": applied, "action": action, "player": body.player }),
    ))
}

/// POST /api/server/kick
pub async fn kick_player(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<PlayerTargetBody>,
) -> Result<Json<serde_json::Value>> {
    crate::auth::middleware::require_perm(&actor, "server.kick")?;
    let cmd = match body.reason.as_deref() {
        Some(r) => format!("kick {} {r}", body.player),
        None => format!("kick {}", body.player),
    };
    let applied = console::send(&state.config, &cmd).await?;
    audit::log(
        &state.pool,
        &actor.audit_actor(),
        "kick",
        Some(&body.player),
        body.reason.as_deref(),
    )
    .await?;
    Ok(Json(
        serde_json::json!({ "applied": applied, "player": body.player }),
    ))
}

/// POST /api/server/ban/:action  (ban | pardon)
pub async fn ban_action(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(action): Path<String>,
    Json(body): Json<PlayerTargetBody>,
) -> Result<Json<serde_json::Value>> {
    crate::auth::middleware::require_perm(&actor, "server.ban.manage")?;
    let cmd = match action.as_str() {
        "ban" => match body.reason.as_deref() {
            Some(r) => format!("ban {} {r}", body.player),
            None => format!("ban {}", body.player),
        },
        "pardon" => format!("pardon {}", body.player),
        _ => {
            return Err(AppError::BadRequest(format!(
                "Unknown ban action: {action}"
            )))
        }
    };
    let applied = console::send(&state.config, &cmd).await?;
    audit::log(
        &state.pool,
        &actor.audit_actor(),
        &action,
        Some(&body.player),
        body.reason.as_deref(),
    )
    .await?;
    Ok(Json(
        serde_json::json!({ "applied": applied, "action": action, "player": body.player }),
    ))
}

#[derive(Deserialize)]
pub struct AnnounceBody {
    pub message: String,
}

/// POST /api/server/announce  (/say)
pub async fn announce(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<AnnounceBody>,
) -> Result<Json<serde_json::Value>> {
    crate::auth::middleware::require_perm(&actor, "server.announce")?;
    let applied = console::send(&state.config, &format!("say {}", body.message)).await?;
    audit::log(
        &state.pool,
        &actor.audit_actor(),
        "announce",
        None,
        Some(&body.message),
    )
    .await?;
    Ok(Json(serde_json::json!({ "applied": applied })))
}

/// POST /api/server/save  (/save-all)
pub async fn save_world(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<serde_json::Value>> {
    crate::auth::middleware::require_perm(&actor, "server.save")?;
    let applied = console::send(&state.config, "save-all").await?;
    audit::log(&state.pool, &actor.audit_actor(), "save_world", None, None).await?;
    Ok(Json(serde_json::json!({ "applied": applied })))
}
