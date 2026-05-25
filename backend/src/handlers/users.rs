use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;

use crate::{
    auth::middleware::{require_perm, AuthUser},
    db::{audit, players, roles, users},
    error::{AppError, Result},
    minecraft::console,
    state::AppState,
};

/// GET /api/users — requires `users.view`.
/// Any role can be granted this permission; it is seeded for all system roles
/// so the Team page works for every authenticated user.
pub async fn list(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<Vec<users::User>>> {
    require_perm(&actor, "users.view")?;
    Ok(Json(users::list(&state.pool).await?))
}

/// POST /api/users — whitelist a new user (add their email to the system).
///
/// Requires `users.invite`.  The global admin grants this permission to other
/// roles via the admin UI, enabling delegation of the whitelist.
/// The invited user can then sign in with their Google account.
pub async fn invite(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<users::CreateUser>,
) -> Result<(StatusCode, Json<users::User>)> {
    require_perm(&actor, "users.invite")?;

    // Validate the target role exists.
    let target_role = roles::get(&state.pool, &body.role)
        .await?
        .ok_or_else(|| AppError::BadRequest(format!("Role '{}' does not exist", body.role)))?;

    // Level gate: cannot invite to a role equal to or above your own.
    if target_role.level >= actor.level() as i64 && actor.email != users::GLOBAL_ADMIN {
        return Err(AppError::Forbidden(format!(
            "Cannot assign role '{}' (level {}) — your level is {}. \
             You can only invite users to roles strictly below your own.",
            target_role.name,
            target_role.level,
            actor.level()
        )));
    }

    let user = users::create(&state.pool, &actor.email, body).await?;
    audit::log(
        &state.pool,
        &actor.email,
        "invite_user",
        Some(&user.email),
        None,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(user)))
}

#[derive(Deserialize)]
pub struct UpdateUser {
    role: Option<String>,
    display_name: Option<String>,
}

pub async fn update(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(email): Path<String>,
    Json(body): Json<UpdateUser>,
) -> Result<StatusCode> {
    if !actor.can_manage_users() {
        return Err(AppError::Forbidden("manage_users required".into()));
    }
    let target = users::get(&state.pool, &email)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("{email} not found")))?;

    // DB-backed level check: works for both system and custom roles.
    let target_level = roles::level_for(&state.pool, &target.role).await;
    if target_level >= actor.level() as i64 && actor.email != users::GLOBAL_ADMIN {
        return Err(AppError::Forbidden(
            "Cannot modify a user with equal or higher role".into(),
        ));
    }

    if let Some(new_role) = &body.role {
        let new_role_data = roles::get(&state.pool, new_role)
            .await?
            .ok_or_else(|| AppError::BadRequest(format!("Role '{new_role}' does not exist")))?;
        if new_role_data.level >= actor.level() as i64 && actor.email != users::GLOBAL_ADMIN {
            return Err(AppError::Forbidden(
                "Cannot assign role equal to or above your own".into(),
            ));
        }
        users::update_role(&state.pool, &email, new_role).await?;
    }
    if let Some(name) = &body.display_name {
        users::update_display_name(&state.pool, &email, name).await?;
    }
    audit::log(&state.pool, &actor.email, "update_user", Some(&email), None).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(email): Path<String>,
) -> Result<StatusCode> {
    if !actor.can_manage_users() {
        return Err(AppError::Forbidden("manage_users required".into()));
    }
    let target = users::get(&state.pool, &email)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("{email} not found")))?;

    let target_level = roles::level_for(&state.pool, &target.role).await;
    if target_level >= actor.level() as i64 && actor.email != users::GLOBAL_ADMIN {
        return Err(AppError::Forbidden(
            "Cannot remove a user with equal or higher role".into(),
        ));
    }
    users::remove(&state.pool, &email).await?;
    audit::log(&state.pool, &actor.email, "remove_user", Some(&email), None).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── Player link handlers ───────────────────────────────────────────────────────

pub async fn list_players(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(email): Path<String>,
) -> Result<Json<Vec<players::PlayerLink>>> {
    // Members can only view their own; admins can view anyone's
    if email != actor.email && !actor.can_manage_users() {
        return Err(AppError::Forbidden("Forbidden".into()));
    }
    Ok(Json(players::list_for_user(&state.pool, &email).await?))
}

#[derive(Deserialize)]
pub struct ReplacePlayersBody {
    pub igns: Vec<String>,
}

pub async fn replace_players(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(email): Path<String>,
    Json(body): Json<ReplacePlayersBody>,
) -> Result<StatusCode> {
    if email != actor.email && !actor.can_manage_users() {
        return Err(AppError::Forbidden("Forbidden".into()));
    }
    players::replace_all(&state.pool, &email, &body.igns).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn unlink_player(
    State(state): State<AppState>,
    actor: AuthUser,
    Path((email, ign)): Path<(String, String)>,
) -> Result<StatusCode> {
    if email != actor.email && !actor.can_manage_users() {
        return Err(AppError::Forbidden("Forbidden".into()));
    }
    players::remove(&state.pool, &email, &ign).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct SetGamemodeBody {
    pub gamemode: String,
}

pub async fn set_player_gamemode(
    State(state): State<AppState>,
    actor: AuthUser,
    Path((email, ign)): Path<(String, String)>,
    Json(body): Json<SetGamemodeBody>,
) -> Result<Json<serde_json::Value>> {
    // Members can set their own; admin+ can set anyone's
    let allowed = email == actor.email || actor.can_manage_users();
    if !allowed {
        return Err(AppError::Forbidden("Forbidden".into()));
    }
    players::set_gamemode(&state.pool, &email, &ign, &body.gamemode).await?;
    // Apply live to the server (best-effort; ignore if offline)
    let applied = console::set_gamemode(&state.config, &ign, &body.gamemode)
        .await
        .unwrap_or(false);
    Ok(Json(serde_json::json!({ "saved": true, "applied": applied })))
}
