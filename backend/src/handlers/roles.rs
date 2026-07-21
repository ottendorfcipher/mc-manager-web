//! Role management endpoints.
//!
//! Security model:
//!   • Reading roles: `roles.view`
//!   • Creating a custom role: `roles.create`; role level must be < actor level
//!   • Editing a role's metadata: `roles.edit`
//!   • Editing a role's permissions: `roles.edit`
//!   • Deleting a custom role: `roles.delete`; role must have 0 assigned users
//!   • System roles (is_system = 1) cannot be deleted or renamed/re-levelled
//!
//! Per-user override endpoints are here too (user-scoped but admin-managed):
//!   • Listing overrides: `users.permission_overrides.edit`
//!   • Adding an override: `users.permission_overrides.edit`
//!   • Removing an override: `users.permission_overrides.edit`

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    auth::middleware::{require_perm, AuthUser},
    db::{audit, permissions, roles},
    error::{AppError, Result},
    state::AppState,
};

// ── Role catalog ───────────────────────────────────────────────────────────────

/// GET /api/roles — list all roles (system + custom), ordered highest level first.
pub async fn list(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<Vec<roles::Role>>> {
    require_perm(&actor, "roles.view")?;
    Ok(Json(roles::list(&state.pool).await?))
}

/// GET /api/roles/:role — single role detail.
pub async fn get(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(role_name): Path<String>,
) -> Result<Json<roles::Role>> {
    require_perm(&actor, "roles.view")?;
    roles::get(&state.pool, &role_name)
        .await?
        .map(Json)
        .ok_or_else(|| AppError::NotFound(format!("Role '{role_name}' not found")))
}

/// POST /api/roles — create a new custom role.
///
/// The new role's level must be strictly below the actor's own level
/// (you cannot create a role that could outrank you).
pub async fn create(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<roles::CreateRole>,
) -> Result<(StatusCode, Json<roles::Role>)> {
    require_perm(&actor, "roles.create")?;

    // Level gate: only create roles below your own authority.
    // global_admin (level 4) can create level 0–3; no one can create level 4+.
    if body.level >= actor.level() as i64 {
        return Err(AppError::Forbidden(format!(
            "Cannot create a role with level {} (your level is {}). \
             Assign a level strictly below your own.",
            body.level,
            actor.level()
        )));
    }

    let role = roles::create(&state.pool, &actor.email, body).await?;
    audit::log(
        &state.pool,
        &actor.audit_actor(),
        "create_role",
        Some(&role.name),
        None,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(role)))
}

/// PATCH /api/roles/:role — update label, description, color, or (for custom roles) level.
pub async fn update(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(role_name): Path<String>,
    Json(body): Json<roles::UpdateRole>,
) -> Result<Json<roles::Role>> {
    require_perm(&actor, "roles.edit")?;

    let role = roles::get(&state.pool, &role_name)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Role '{role_name}' not found")))?;

    // Ceiling: cannot edit a role at or above your own level (stops a lower
    // admin from re-labelling / re-levelling a peer or superior role).
    if role.level >= actor.level() as i64 && actor.email != crate::db::users::global_admin() {
        return Err(AppError::Forbidden(
            "Cannot edit a role at or above your own level".into(),
        ));
    }

    // Level gate for custom roles: new level must be below actor's level.
    if let Some(new_level) = body.level {
        if new_level >= actor.level() as i64 {
            return Err(AppError::Forbidden(format!(
                "Cannot set level {} on a role (your level is {})",
                new_level,
                actor.level()
            )));
        }
    }

    let updated = roles::update(&state.pool, &role_name, body, role.is_system).await?;
    audit::log(
        &state.pool,
        &actor.audit_actor(),
        "update_role",
        Some(&role_name),
        None,
    )
    .await?;
    Ok(Json(updated))
}

/// DELETE /api/roles/:role — delete a custom role.
///
/// Guards:
///   • System roles are immutable — they cannot be deleted.
///   • A role with any assigned users cannot be deleted.
///     (Reassign them first via PATCH /api/users/:email.)
pub async fn delete(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(role_name): Path<String>,
) -> Result<StatusCode> {
    require_perm(&actor, "roles.delete")?;

    let role = roles::get(&state.pool, &role_name)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Role '{role_name}' not found")))?;

    if role.is_system {
        return Err(AppError::Forbidden(
            "System roles cannot be deleted. You can edit their label, description, and color."
                .into(),
        ));
    }

    let member_count = roles::count_users(&state.pool, &role_name).await?;
    if member_count > 0 {
        return Err(AppError::Conflict(format!(
            "{member_count} user(s) still have the '{role_name}' role. \
             Reassign them before deleting this role."
        )));
    }

    roles::delete(&state.pool, &role_name).await?;
    audit::log(
        &state.pool,
        &actor.audit_actor(),
        "delete_role",
        Some(&role_name),
        None,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── Role permission management ─────────────────────────────────────────────────

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct RolePermissions {
    pub role: String,
    pub permissions: Vec<String>,
}

/// GET /api/roles/:role/permissions — list permissions for a specific role.
pub async fn get_permissions(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(role_name): Path<String>,
) -> Result<Json<RolePermissions>> {
    require_perm(&actor, "roles.view")?;
    Ok(Json(RolePermissions {
        permissions: permissions::for_role(&state.pool, &role_name).await?,
        role: role_name,
    }))
}

#[derive(Debug, Deserialize)]
pub struct SetPermissionsBody {
    pub permissions: Vec<String>,
}

/// PUT /api/roles/:role/permissions — replace the full permission set for a role.
///
/// Actors cannot grant permissions they do not themselves hold (privilege escalation guard).
pub async fn set_permissions(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(role_name): Path<String>,
    Json(body): Json<SetPermissionsBody>,
) -> Result<Json<RolePermissions>> {
    require_perm(&actor, "roles.edit")?;

    // Ceiling: cannot rewrite the permissions of a role at or above your own
    // level (stops stripping/re-permissioning a peer or superior role).
    let role = roles::get(&state.pool, &role_name)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Role '{role_name}' not found")))?;
    if role.level >= actor.level() as i64 && actor.email != crate::db::users::global_admin() {
        return Err(AppError::Forbidden(
            "Cannot edit permissions of a role at or above your own level".into(),
        ));
    }

    // Privilege escalation guard: actors cannot grant permissions they don't have,
    // unless they are global_admin (level 4).
    if actor.level() < 4 {
        for key in &body.permissions {
            if !actor.has(key) {
                return Err(AppError::Forbidden(format!(
                    "Cannot grant permission '{key}' — you don't hold it yourself."
                )));
            }
        }
    }

    permissions::set_for_role(&state.pool, &role_name, &body.permissions).await?;
    audit::log(
        &state.pool,
        &actor.audit_actor(),
        "set_role_permissions",
        Some(&role_name),
        Some(&format!("{} permissions", body.permissions.len())),
    )
    .await?;
    Ok(Json(RolePermissions {
        permissions: permissions::for_role(&state.pool, &role_name).await?,
        role: role_name,
    }))
}

// ── Per-user permission overrides ──────────────────────────────────────────────

/// GET /api/users/:email/permission-overrides
pub async fn list_overrides(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(email): Path<String>,
) -> Result<Json<Vec<permissions::PermissionOverride>>> {
    require_perm(&actor, "users.permission_overrides.edit")?;
    Ok(Json(
        permissions::list_overrides(&state.pool, &email).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AddOverrideBody {
    pub permission_key: String,
}

/// POST /api/users/:email/permission-overrides
///
/// Privilege escalation guard: actors cannot grant overrides for permissions
/// they do not themselves hold (unless global_admin).
pub async fn add_override(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(email): Path<String>,
    Json(body): Json<AddOverrideBody>,
) -> Result<StatusCode> {
    require_perm(&actor, "users.permission_overrides.edit")?;

    if actor.level() < 4 && !actor.has(&body.permission_key) {
        return Err(AppError::Forbidden(format!(
            "Cannot grant override for '{}' — you don't hold that permission yourself.",
            body.permission_key
        )));
    }

    permissions::add_override(&state.pool, &email, &body.permission_key, &actor.email).await?;
    audit::log(
        &state.pool,
        &actor.audit_actor(),
        "add_permission_override",
        Some(&email),
        Some(&body.permission_key),
    )
    .await?;
    Ok(StatusCode::CREATED)
}

/// DELETE /api/users/:email/permission-overrides/:key
pub async fn remove_override(
    State(state): State<AppState>,
    actor: AuthUser,
    Path((email, key)): Path<(String, String)>,
) -> Result<StatusCode> {
    require_perm(&actor, "users.permission_overrides.edit")?;
    permissions::remove_override(&state.pool, &email, &key).await?;
    audit::log(
        &state.pool,
        &actor.audit_actor(),
        "remove_permission_override",
        Some(&email),
        Some(&key),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
