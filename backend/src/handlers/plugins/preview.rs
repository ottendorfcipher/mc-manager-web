//! Dependency preview before install.
//!
//! GET /api/plugins/preview/:project_key
//!
//! Returns the resolved dependency plan for a plugin WITHOUT starting a job.
//! The InstallFlow UI calls this before showing the "Add to server" button so
//! the user sees "This also needs Vault and LuckPerms — we'll install them too"
//! before committing.

use axum::{extract::{Path, State}, Json};
use serde::Serialize;

use crate::{
    auth::middleware::AuthUser,
    db::{installed_plugins, plugins_catalog},
    error::Result,
    minecraft::modrinth,
    state::AppState,
};

#[derive(Serialize)]
pub struct DependencyPreview {
    /// Required helpers that aren't installed yet.
    pub missing_deps:  Vec<DepInfo>,
    /// Required helpers that are already installed.
    pub satisfied_deps: Vec<DepInfo>,
    /// Incompatible plugins already on the server.
    pub conflicts: Vec<ConflictInfo>,
    /// Whether the plugin can be installed as-is (no conflicts, no missing deps
    /// the user needs to know about — we'll auto-install them).
    pub can_install: bool,
    /// The version that would be installed.
    pub version: Option<String>,
}

#[derive(Serialize)]
pub struct DepInfo {
    pub project_id:     String,
    pub title:          String,
    pub is_installed:   bool,
}

#[derive(Serialize)]
pub struct ConflictInfo {
    pub project_id: String,
    pub title:      String,
}

pub async fn preview(
    State(state): State<AppState>,
    _: AuthUser,
    Path(project_key): Path<String>,
) -> Result<Json<DependencyPreview>> {
    let slug = project_key
        .strip_prefix("modrinth:")
        .unwrap_or(&project_key)
        .to_string();

    let pat = crate::handlers::modrinth_settings::get_pat(&state).await;
    let client = modrinth::build_client_with_pat(pat.as_deref());

    let installed = installed_plugins::list(&state.pool).await.unwrap_or_default();

    // Get the latest compatible version.
    let version = modrinth::get_latest_compatible_version(&client, &slug)
        .await
        .ok()
        .flatten();

    let version_number = version.as_ref().map(|v| v.version_number.clone());
    let deps = version.as_ref().map(|v| v.dependencies.clone()).unwrap_or_default();

    let mut missing_deps:   Vec<DepInfo>    = Vec::new();
    let mut satisfied_deps: Vec<DepInfo>    = Vec::new();
    let mut conflicts:       Vec<ConflictInfo> = Vec::new();

    for dep in &deps {
        match dep.dependency_type.as_str() {
            "required" => {
                if let Some(dep_pid) = &dep.project_id {
                    let key          = format!("modrinth:{dep_pid}");
                    let is_installed = installed.iter().any(|p| {
                        p.project_key.as_deref() == Some(&key)
                    });

                    // Resolve a human-readable title — check catalog cache first.
                    let title = resolve_title(&state, dep_pid, &client).await;

                    if is_installed {
                        satisfied_deps.push(DepInfo { project_id: dep_pid.clone(), title, is_installed: true });
                    } else {
                        missing_deps.push(DepInfo { project_id: dep_pid.clone(), title, is_installed: false });
                    }
                }
            }
            "incompatible" => {
                if let Some(dep_pid) = &dep.project_id {
                    let key = format!("modrinth:{dep_pid}");
                    if installed.iter().any(|p| p.project_key.as_deref() == Some(&key)) {
                        let title = resolve_title(&state, dep_pid, &client).await;
                        conflicts.push(ConflictInfo { project_id: dep_pid.clone(), title });
                    }
                }
            }
            _ => {}
        }
    }

    let can_install = conflicts.is_empty();

    Ok(Json(DependencyPreview {
        missing_deps,
        satisfied_deps,
        conflicts,
        can_install,
        version: version_number,
    }))
}

/// Look up a plugin's title: catalog cache → Modrinth API → fallback to ID.
async fn resolve_title(state: &AppState, project_id: &str, client: &reqwest::Client) -> String {
    let key = format!("modrinth:{project_id}");

    // Try catalog cache first (fast, no network).
    if let Ok(Some(cached)) = plugins_catalog::get_by_key(&state.pool, &key).await {
        return cached.title;
    }

    // Fall back to Modrinth.
    if let Ok(project) = modrinth::get_project(client, project_id).await {
        // Cache for next time.
        let _ = plugins_catalog::upsert(
            &state.pool, &key, "modrinth",
            &project.slug, &project.title, project.icon_url.as_deref(),
            Some(&project.description),
            r#"["paper","spigot","bukkit"]"#, r#"["1.21"]"#,
            project.downloads as i64, project.follows as i64,
            project.license.as_ref().map(|l| l.id.as_str()),
            project.source_url.as_deref(), None,
        ).await;
        return project.title;
    }

    // Last resort: use the Modrinth project ID as-is.
    project_id.to_string()
}
