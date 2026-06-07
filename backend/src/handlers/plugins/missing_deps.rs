//! Detect missing hard dependencies of installed plugins, and suggest installs.
//!
//! A plugin.yml `depend:` entry references another plugin's `name:`. If no
//! installed plugin declares that name, the dependency is MISSING and the server
//! may refuse to load the dependent plugin. We surface those and, where the name
//! maps to a Modrinth project, offer one-click install (which reuses the normal
//! POST /plugins/install job, so the dependency's own sub-deps are resolved too).

use std::collections::{BTreeMap, HashSet};

use axum::{extract::State, Json};
use serde::Serialize;
use ts_rs::TS;

use crate::{
    auth::middleware::AuthUser,
    db::installed_plugins,
    error::Result,
    minecraft::modrinth,
    state::AppState,
};

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct DepSuggestion {
    pub project_key: String,          // "modrinth:{slug}" — feed straight to install
    pub title:       String,
    pub icon_url:    Option<String>,
    pub downloads:   u64,
    /// True when a Modrinth hit's title/slug normalises exactly to the dep name.
    pub confident:   bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct MissingDep {
    pub name:        String,          // plugin.yml depend name, e.g. "Vault"
    pub required_by: Vec<String>,     // installed plugins that declare this depend
    pub suggestion:  Option<DepSuggestion>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct MissingDepsResponse {
    pub missing: Vec<MissingDep>,
}

/// Normalise a name for comparison: lowercase, alphanumerics only
/// ("ProtocolLib" == "protocollib", "Vault" == "vault").
fn norm(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// GET /api/plugins/missing-deps
pub async fn list(
    State(state): State<AppState>,
    actor: AuthUser,
) -> Result<Json<MissingDepsResponse>> {
    crate::auth::middleware::require_perm(&actor, "nav.plugins")?;

    let installed = installed_plugins::list(&state.pool).await?;

    // What the server already provides: each installed plugin's plugin.yml name.
    let provided: HashSet<String> = installed
        .iter()
        .filter_map(|p| p.declared_name.as_deref())
        .map(norm)
        .collect();

    // dep-name -> requiring plugin display names.
    let mut map: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for p in &installed {
        let deps: Vec<String> = serde_json::from_str(&p.depends_json).unwrap_or_default();
        let who = p.declared_name.clone().unwrap_or_else(|| p.filename.clone());
        for d in deps {
            let d = d.trim().to_string();
            if d.is_empty() {
                continue;
            }
            if !provided.contains(&norm(&d)) {
                map.entry(d).or_default().push(who.clone());
            }
        }
    }

    // Suggest a Modrinth project for each missing dep.
    let client = modrinth::build_client_with_pat(
        crate::handlers::modrinth_settings::get_pat(&state).await.as_deref(),
    );

    let mut missing = Vec::with_capacity(map.len());
    for (name, mut required_by) in map {
        required_by.sort();
        required_by.dedup();

        let suggestion = match modrinth::search(&client, &name, 5, 0).await {
            Ok(resp) => {
                let want = norm(&name);
                let confident_hit = resp
                    .hits
                    .iter()
                    .find(|h| norm(&h.title) == want || norm(&h.slug) == want);
                let confident = confident_hit.is_some();
                confident_hit.or_else(|| resp.hits.first()).map(|h| DepSuggestion {
                    project_key: format!("modrinth:{}", h.slug),
                    title:       h.title.clone(),
                    icon_url:    h.icon_url.clone(),
                    downloads:   h.downloads,
                    confident,
                })
            }
            Err(_) => None,
        };

        missing.push(MissingDep { name, required_by, suggestion });
    }

    Ok(Json(MissingDepsResponse { missing }))
}
