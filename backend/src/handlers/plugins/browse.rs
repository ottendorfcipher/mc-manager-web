use axum::{extract::{Query, State}, Json};
use serde::{Deserialize, Serialize};

use crate::{
    auth::middleware::AuthUser,
    db::{installed_plugins, plugin_goals, plugins_catalog},
    error::Result,
    minecraft::modrinth,
    state::AppState,
};

// Starter essentials shown when no query and no goal.
const STARTER_ESSENTIALS: &[&str] = &[
    "essentialsx", "worldguard", "luckperms", "vault",
    "coreprotect", "huskhomes", "viaversion", "worldedit",
];

#[derive(Debug, Deserialize)]
pub struct BrowseParams {
    pub q:      Option<String>,
    pub goal:   Option<String>,
    pub limit:  Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct BrowseResponse {
    pub results: Vec<CatalogSummary>,
    pub total:   u32,
}

#[derive(Debug, Serialize)]
pub struct CatalogSummary {
    pub project_key:  String,
    pub slug:         String,
    pub title:        String,
    pub icon_url:     Option<String>,
    pub description:  String,
    pub downloads:    u64,
    pub compatible:   bool,
    pub is_installed: bool,
}

pub async fn browse(
    State(state): State<AppState>,
    _: AuthUser,
    Query(params): Query<BrowseParams>,
) -> Result<Json<BrowseResponse>> {
    let limit  = params.limit.unwrap_or(20).min(50);
    let offset = params.offset.unwrap_or(0);

    let installed = installed_plugins::list(&state.pool).await.unwrap_or_default();

    if let Some(goal_slug) = &params.goal {
        // Load goal picks and return catalog entries.
        let picks = plugin_goals::get_picks(&state.pool, goal_slug).await.unwrap_or_default();
        let keys: Vec<String> = picks.iter().map(|p| p.project_key.clone()).collect();
        let cached = plugins_catalog::list_by_keys(&state.pool, &keys).await.unwrap_or_default();

        // If cache is missing entries, fetch from Modrinth.
        let mut results: Vec<CatalogSummary> = cached.iter().map(|c| {
            let is_installed = installed.iter().any(|p| {
                p.project_key.as_deref() == Some(&c.project_key)
            });
            CatalogSummary {
                project_key:  c.project_key.clone(),
                slug:         c.slug.clone(),
                title:        c.title.clone(),
                icon_url:     c.icon_url.clone(),
                description:  c.description.clone().unwrap_or_default(),
                downloads:    c.downloads as u64,
                compatible:   true,
                is_installed,
            }
        }).collect();

        // Fetch missing picks from Modrinth.
        let cached_keys: std::collections::HashSet<String> = cached.iter()
            .map(|c| c.project_key.clone()).collect();
        let client = modrinth::build_client_with_pat(crate::handlers::modrinth_settings::get_pat(&state).await.as_deref());
        for pick in &picks {
            if cached_keys.contains(&pick.project_key) { continue; }
            let slug = pick.project_key
                .strip_prefix("modrinth:")
                .unwrap_or(&pick.project_key);
            if let Ok(project) = modrinth::get_project(&client, slug).await {
                let is_installed = installed.iter().any(|p| {
                    p.project_key.as_deref() == Some(&pick.project_key)
                });
                let _ = plugins_catalog::upsert(
                    &state.pool, &pick.project_key, "modrinth",
                    &project.slug, &project.title,
                    project.icon_url.as_deref(),
                    Some(&project.description),
                    r#"["paper","spigot","bukkit"]"#, r#"["1.21"]"#,
                    project.downloads as i64, project.follows as i64,
                    project.license.as_ref().map(|l| l.id.as_str()),
                    project.source_url.as_deref(), None,
                ).await;
                results.push(CatalogSummary {
                    project_key:  pick.project_key.clone(),
                    slug:         project.slug,
                    title:        project.title,
                    icon_url:     project.icon_url,
                    description:  project.description,
                    downloads:    project.downloads,
                    compatible:   true,
                    is_installed,
                });
            }
        }

        let total = results.len() as u32;
        return Ok(Json(BrowseResponse { results, total }));
    }

    if let Some(q) = &params.q {
        if !q.is_empty() {
            // Search Modrinth and cache results.
            let client = modrinth::build_client_with_pat(crate::handlers::modrinth_settings::get_pat(&state).await.as_deref());
            let search_result = modrinth::search(&client, q, limit, offset).await;

            let results = match search_result {
                Ok(resp) => {
                    let total = resp.total_hits;
                    let mut summaries = Vec::with_capacity(resp.hits.len());
                    for hit in resp.hits {
                        let project_key = format!("modrinth:{}", hit.slug);
                        let is_installed = installed.iter().any(|p| {
                            p.project_key.as_deref() == Some(&project_key)
                        });
                        let _ = plugins_catalog::upsert(
                            &state.pool, &project_key, "modrinth",
                            &hit.slug, &hit.title, hit.icon_url.as_deref(),
                            Some(&hit.description),
                            r#"["paper","spigot","bukkit"]"#, r#"["1.21"]"#,
                            hit.downloads as i64, hit.follows as i64,
                            None, None, Some(&hit.date_modified),
                        ).await;
                        summaries.push(CatalogSummary {
                            project_key,
                            slug:         hit.slug,
                            title:        hit.title,
                            icon_url:     hit.icon_url,
                            description:  hit.description,
                            downloads:    hit.downloads,
                            compatible:   true,
                            is_installed,
                        });
                    }
                    return Ok(Json(BrowseResponse { results: summaries, total }));
                }
                Err(_) => {
                    // Fall back to cached search.
                    plugins_catalog::search_cached(&state.pool, q, limit as i64)
                        .await
                        .unwrap_or_default()
                }
            };

            let summaries: Vec<CatalogSummary> = results.into_iter().map(|c| {
                let is_installed = installed.iter().any(|p| {
                    p.project_key.as_deref() == Some(&c.project_key)
                });
                CatalogSummary {
                    project_key:  c.project_key,
                    slug:         c.slug,
                    title:        c.title,
                    icon_url:     c.icon_url,
                    description:  c.description.unwrap_or_default(),
                    downloads:    c.downloads as u64,
                    compatible:   true,
                    is_installed,
                }
            }).collect();
            let total = summaries.len() as u32;
            return Ok(Json(BrowseResponse { results: summaries, total }));
        }
    }

    // Default: return starter essentials.
    let pat = crate::handlers::modrinth_settings::get_pat(&state).await;
    tracing::debug!("plugins/browse: PAT configured={}", pat.is_some());
    let client = modrinth::build_client_with_pat(pat.as_deref());
    let mut results = Vec::new();

    for slug in STARTER_ESSENTIALS {
        let project_key = format!("modrinth:{slug}");
        let is_installed = installed.iter().any(|p| {
            p.project_key.as_deref() == Some(&project_key)
        });

        // Check cache first.
        if let Ok(Some(cached)) = plugins_catalog::get_by_key(&state.pool, &project_key).await {
            results.push(CatalogSummary {
                project_key:  cached.project_key,
                slug:         cached.slug,
                title:        cached.title,
                icon_url:     cached.icon_url,
                description:  cached.description.unwrap_or_default(),
                downloads:    cached.downloads as u64,
                compatible:   true,
                is_installed,
            });
        } else {
            match modrinth::get_project(&client, slug).await {
                Ok(project) => {
                    let _ = plugins_catalog::upsert(
                        &state.pool, &project_key, "modrinth",
                        &project.slug, &project.title, project.icon_url.as_deref(),
                        Some(&project.description),
                        r#"["paper","spigot","bukkit"]"#, r#"["1.21"]"#,
                        project.downloads as i64, project.follows as i64,
                        project.license.as_ref().map(|l| l.id.as_str()),
                        project.source_url.as_deref(), None,
                    ).await;
                    results.push(CatalogSummary {
                        project_key,
                        slug:         project.slug,
                        title:        project.title,
                        icon_url:     project.icon_url,
                        description:  project.description,
                        downloads:    project.downloads,
                        compatible:   true,
                        is_installed,
                    });
                }
                Err(e) => {
                    tracing::warn!("plugins/browse: get_project({slug}) failed: {e}");
                }
            }
        }
    }

    tracing::debug!("plugins/browse: returning {} results", results.len());
    let total = results.len() as u32;
    Ok(Json(BrowseResponse { results, total }))
}
