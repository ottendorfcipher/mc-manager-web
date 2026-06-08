use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, StatusCode},
    response::Response,
    Json,
};
use serde::Deserialize;

use crate::{
    auth::middleware::AuthUser,
    db::{audit, backups, worlds},
    error::{AppError, Result},
    minecraft::{backup, world_switch},
    state::AppState,
};

// ── Request bodies ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateWorldBody {
    pub name:        String,
    pub slug:        String,
    pub description: Option<String>,
    pub seed:        Option<String>,
}

#[derive(Deserialize)]
pub struct SetMembersBody {
    pub emails: Vec<String>,
}

// ── World CRUD ────────────────────────────────────────────────────────────────

/// GET /api/worlds
pub async fn list(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<Vec<worlds::World>>> {
    crate::auth::middleware::require_perm(&actor, "worlds.view")?;
    Ok(Json(worlds::list(&state.pool).await?))
}

/// POST /api/worlds
pub async fn create(
    State(state): State<AppState>,
    actor: AuthUser,
    Json(body): Json<CreateWorldBody>,
) -> Result<(StatusCode, Json<worlds::World>)> {
    crate::auth::middleware::require_perm(&actor, "worlds.create")?;

    // Validate slug: lowercase alphanumeric + hyphens/underscores only
    let slug = body.slug.trim().to_lowercase();
    if slug.is_empty()
        || !slug
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::BadRequest(
            "Slug must be non-empty and contain only a–z, 0–9, hyphens, or underscores".into(),
        ));
    }
    if worlds::slug_exists(&state.pool, &slug).await? {
        return Err(AppError::Conflict(format!(
            "A world with slug '{slug}' already exists"
        )));
    }

    // Create directory structure on mc-server-1
    world_switch::ensure_world_dirs(&state.config, &slug).await?;

    let id = worlds::insert(
        &state.pool,
        body.name.trim(),
        &slug,
        body.description.as_deref(),
        body.seed.as_deref(),
        &actor.email,
    )
    .await?;

    let world = worlds::get(&state.pool, id).await?.ok_or_else(|| {
        AppError::Internal(anyhow::anyhow!("World not found after insert"))
    })?;

    audit::log(&state.pool, &actor.audit_actor(), "create_world", Some(&slug), None).await?;
    Ok((StatusCode::CREATED, Json(world)))
}

/// DELETE /api/worlds/:id
pub async fn delete(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "worlds.delete")?;

    let world = worlds::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("World {id} not found")))?;

    if world.is_active {
        return Err(AppError::BadRequest(
            "Cannot delete the active world — switch to another world first".into(),
        ));
    }

    worlds::remove(&state.pool, id).await?;
    audit::log(
        &state.pool,
        &actor.audit_actor(),
        "delete_world",
        Some(&world.slug),
        None,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/worlds/:id/activate
///
/// Switches the active world. Runs `world-switch.sh` over SSH
/// (stops MC, saves current world, loads target world, restarts MC).
/// The DB active flag is only updated if the script succeeds.
pub async fn activate(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "worlds.switch")?;

    let target = worlds::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("World {id} not found")))?;

    if target.is_active {
        return Err(AppError::BadRequest(
            "This world is already active".into(),
        ));
    }

    let current = worlds::get_active(&state.pool)
        .await?
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("No active world in DB")))?;

    // Run the switch script (may take a few minutes for large worlds)
    world_switch::switch_world(&state.config, &current.slug, &target.slug).await?;

    // Script succeeded — update the DB flag
    worlds::set_active(&state.pool, id).await?;

    // Kick off a background sync so the new world's existing backups appear
    let pool   = state.pool.clone();
    let cfg    = state.config.clone();
    let t_id   = target.id;
    let t_slug = target.slug.clone();
    tokio::spawn(async move {
        backup::sync_world_backup_into_db(&pool, &cfg, t_id, &t_slug).await;
    });

    audit::log(
        &state.pool,
        &actor.audit_actor(),
        "switch_world",
        Some(&format!("{} → {}", current.slug, target.slug)),
        None,
    )
    .await?;

    // Notify opted-in admins that the active world changed (fire-and-forget).
    {
        let state2 = state.clone();
        let from = crate::notify::html_escape(&current.slug);
        let to = crate::notify::html_escape(&target.slug);
        let who = crate::notify::html_escape(&actor.email);
        tokio::spawn(async move {
            let site = state2.config.site_url.trim_end_matches('/').to_string();
            let subject = format!("World switched: {from} → {to}");
            let html = format!(
                "<p>The active Minecraft world was switched from <strong>{from}</strong> to \
                 <strong>{to}</strong> by {who}.</p><p><a href=\"{site}/admin\">Open admin →</a></p>"
            );
            let text = format!("World switched {from} → {to} by {who}.");
            crate::notify::notify_admins(&state2, "world_switch", &subject, &html, &text).await;
        });
    }

    Ok(StatusCode::ACCEPTED)
}

// ── World members ─────────────────────────────────────────────────────────────

/// GET /api/worlds/:id/members
pub async fn list_members(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<Json<Vec<worlds::WorldMember>>> {
    crate::auth::middleware::require_perm(&actor, "worlds.view")?;
    worlds::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("World {id} not found")))?;
    Ok(Json(worlds::list_members(&state.pool, id).await?))
}

/// PUT /api/worlds/:id/members
pub async fn set_members(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
    Json(body): Json<SetMembersBody>,
) -> Result<StatusCode> {
    crate::auth::middleware::require_perm(&actor, "worlds.members.manage")?;
    worlds::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("World {id} not found")))?;
    worlds::set_members(&state.pool, id, &body.emails).await?;
    audit::log(
        &state.pool,
        &actor.audit_actor(),
        "update_world_members",
        Some(&id.to_string()),
        None,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── World-scoped backups ──────────────────────────────────────────────────────

/// GET /api/worlds/:id/backups
pub async fn list_backups(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<Json<Vec<backups::BackupRun>>> {
    crate::auth::middleware::require_perm(&actor, "worlds.view")?;
    let world = worlds::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("World {id} not found")))?;

    // Sync any new files from the server first
    backup::sync_world_backup_into_db(&state.pool, &state.config, id, &world.slug).await;

    Ok(Json(
        backups::list_by_world(&state.pool, id, &world.slug).await?,
    ))
}

/// POST /api/worlds/:id/backups
///
/// Triggers `world-backup.sh <slug>` on mc-server-1, syncs the result,
/// and returns the new BackupRun record. The backup is stored at
/// `/opt/minecraft/backups/<slug>/daily/<timestamp>.tar.gz`.
pub async fn create_backup(
    State(state): State<AppState>,
    actor: AuthUser,
    Path(id): Path<i64>,
) -> Result<(StatusCode, Json<backups::BackupRun>)> {
    crate::auth::middleware::require_perm(&actor, "worlds.backups.create")?;

    let world = worlds::get(&state.pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("World {id} not found")))?;

    // Run the backup script on mc-server-1
    let remote_path = world_switch::create_world_backup(&state.config, &world.slug)
        .await
        .map_err(|e| {
            tracing::error!(world_slug = %world.slug, error = %e, "World backup failed");
            e
        })?;

    let filename = remote_path
        .rsplit('/')
        .next()
        .unwrap_or(&remote_path)
        .to_string();

    // Sync to pick up the new file (and any other new cron backups for this world)
    backup::sync_world_backup_into_db(&state.pool, &state.config, id, &world.slug).await;

    let run = backups::get_by_filename(&state.pool, &filename)
        .await?
        .ok_or_else(|| {
            AppError::Internal(anyhow::anyhow!(
                "Backup created but not found in DB after sync"
            ))
        })?;

    audit::log(
        &state.pool,
        &actor.audit_actor(),
        "create_world_backup",
        Some(&format!("{} ({})", filename, world.slug)),
        Some("mc-server-1"),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(run)))
}

/// GET /api/worlds/:world_id/backups/:backup_id  — stream the archive
pub async fn download_backup(
    State(state): State<AppState>,
    actor: AuthUser,
    Path((world_id, backup_id)): Path<(i64, i64)>,
) -> Result<Response> {
    crate::auth::middleware::require_perm(&actor, "worlds.view")?;

    // Confirm the backup belongs to this world
    worlds::get(&state.pool, world_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("World {world_id} not found")))?;

    let run = backups::get(&state.pool, backup_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Backup {backup_id} not found")))?;

    let stream = backup::stream_file(&state.config, &run.file_path)?;
    let body = Body::from_stream(stream);

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/gzip")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", run.filename),
        )
        .body(body)
        .unwrap())
}
