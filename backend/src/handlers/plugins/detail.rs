use axum::{extract::{Path, State}, Json};
use serde::Serialize;

use crate::{
    auth::middleware::AuthUser,
    db::{installed_plugins, plugins_catalog},
    error::Result,
    minecraft::modrinth,
    state::AppState,
};

#[derive(Debug, Serialize)]
pub struct PluginDetail {
    pub project_key:    String,
    pub slug:           String,
    pub title:          String,
    pub description:    String,
    pub icon_url:       Option<String>,
    pub downloads:      u64,
    pub follows:        u64,
    pub latest_version: Option<String>,
    pub is_installed:   bool,
    pub dependencies:   Vec<DepSummary>,
}

#[derive(Debug, Serialize)]
pub struct DepSummary {
    pub title:        String,
    pub dep_type:     String,
    pub is_installed: bool,
}

pub async fn detail(
    State(state): State<AppState>,
    _: AuthUser,
    Path(key): Path<String>,
) -> Result<Json<PluginDetail>> {
    // Normalise key: accept "modrinth:slug" or just "slug".
    let (project_key, slug) = if key.contains(':') {
        let slug = key.split(':').nth(1).unwrap_or(&key).to_string();
        (key.clone(), slug)
    } else {
        (format!("modrinth:{key}"), key.clone())
    };

    let installed = installed_plugins::list(&state.pool).await.unwrap_or_default();
    let is_installed = installed.iter().any(|p| {
        p.project_key.as_deref() == Some(&project_key)
    });

    let client = modrinth::build_client();

    // Try cache first.
    let cached = plugins_catalog::get_by_key(&state.pool, &project_key).await.unwrap_or(None);

    // Fetch from Modrinth for up-to-date info.
    let project = modrinth::get_project(&client, &slug).await.ok();

    let (title, description, icon_url, downloads, follows) = if let Some(ref p) = project {
        (
            p.title.clone(),
            p.description.clone(),
            p.icon_url.clone(),
            p.downloads,
            p.follows,
        )
    } else if let Some(ref c) = cached {
        (
            c.title.clone(),
            c.description.clone().unwrap_or_default(),
            c.icon_url.clone(),
            c.downloads as u64,
            c.follows as u64,
        )
    } else {
        return Err(crate::error::AppError::NotFound(
            format!("Plugin '{key}' not found on Modrinth")
        ));
    };

    // Get latest version.
    let latest_ver = modrinth::get_latest_compatible_version(&client, &slug).await.ok().flatten();
    let latest_version = latest_ver.as_ref().map(|v| v.version_number.clone());

    // Build dependency summaries.
    let mut dependencies: Vec<DepSummary> = vec![];
    if let Some(ver) = &latest_ver {
        for dep in &ver.dependencies {
            if let Some(dep_pid) = &dep.project_id {
                let dep_key = format!("modrinth:{dep_pid}");
                let dep_installed = installed.iter().any(|p| {
                    p.project_key.as_deref() == Some(&dep_key)
                });
                let dep_title = if let Ok(dp) = modrinth::get_project(&client, dep_pid).await {
                    dp.title
                } else {
                    dep_pid.clone()
                };
                dependencies.push(DepSummary {
                    title:        dep_title,
                    dep_type:     dep.dependency_type.clone(),
                    is_installed: dep_installed,
                });
            }
        }
    }

    // Update cache.
    if let Some(p) = &project {
        let _ = plugins_catalog::upsert(
            &state.pool, &project_key, "modrinth",
            &p.slug, &p.title, p.icon_url.as_deref(),
            Some(&p.description),
            r#"["paper","spigot","bukkit"]"#, r#"["1.21"]"#,
            p.downloads as i64, p.follows as i64,
            p.license.as_ref().map(|l| l.id.as_str()),
            p.source_url.as_deref(), None,
        ).await;
    }

    Ok(Json(PluginDetail {
        project_key,
        slug,
        title,
        description,
        icon_url,
        downloads,
        follows,
        latest_version,
        is_installed,
        dependencies,
    }))
}
