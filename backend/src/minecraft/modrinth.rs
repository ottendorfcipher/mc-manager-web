//! Modrinth v2 API client.

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

const BASE_URL: &str = "https://api.modrinth.com/v2";
const USER_AGENT: &str = "redstoneCipher/1.0 (nicholasaweiner@gmail.com)";
// Broad MC version for search facets — includes recent 1.21 variants.
const _MC_VERSION: &str = "1.21.4";

// Compatible loaders.
const LOADERS: &[&str] = &["paper", "spigot", "bukkit", "purpur"];

// Compatible MC version prefixes for version filtering.
const COMPAT_VERSIONS: &[&str] = &["1.21"];

pub fn build_client() -> Client {
    Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .expect("failed to build reqwest client")
}

// ── Response structs ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SearchResponse {
    pub hits:       Vec<SearchHit>,
    pub total_hits: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SearchHit {
    pub project_id:    String,
    pub slug:          String,
    pub title:         String,
    pub description:   String,
    pub icon_url:      Option<String>,
    pub downloads:     u64,
    pub follows:       u64,
    pub versions:      Vec<String>,
    pub date_modified: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModrinthProject {
    pub id:          String,
    pub slug:        String,
    pub title:       String,
    pub description: String,
    pub icon_url:    Option<String>,
    pub downloads:   u64,
    pub follows:     u64,
    pub license:     Option<ModrinthLicense>,
    pub source_url:  Option<String>,
    pub issues_url:  Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModrinthLicense {
    pub id:   String,
    pub name: Option<String>,
    pub url:  Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModrinthVersion {
    pub id:              String,
    pub project_id:      String,
    pub version_number:  String,
    pub game_versions:   Vec<String>,
    pub loaders:         Vec<String>,
    pub dependencies:    Vec<ModrinthDep>,
    pub files:           Vec<ModrinthFile>,
    pub date_published:  String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModrinthDep {
    pub project_id:      Option<String>,
    pub version_id:      Option<String>,
    pub dependency_type: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModrinthFile {
    pub url:      String,
    pub filename: String,
    pub primary:  bool,
    pub size:     u64,
    pub hashes:   ModrinthHashes,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModrinthHashes {
    pub sha1:   Option<String>,
    pub sha512: Option<String>,
}

// ── API functions ────────────────────────────────────────────────────────────

/// Search Modrinth with paper/spigot/bukkit facets and 1.21.x version facets.
pub async fn search(
    client: &Client,
    q:      &str,
    limit:  u32,
    offset: u32,
) -> Result<SearchResponse> {
    // Build facets: categories OR of loaders, versions OR of 1.21.x
    let loader_facets: Vec<String> = LOADERS
        .iter()
        .map(|l| format!(r#"["categories:{l}"]"#))
        .collect();
    let version_facet = r#"["versions:1.21","versions:1.21.1","versions:1.21.2","versions:1.21.3","versions:1.21.4"]"#;
    let facets = format!("[{},{version_facet}]", loader_facets.join(","));

    let url = format!(
        "{BASE_URL}/search?query={q}&limit={limit}&offset={offset}&facets={facets}",
        q = urlencoding::encode(q),
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::ExternalCommand(format!("modrinth search: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        return Err(AppError::ExternalCommand(format!(
            "modrinth search returned {status}"
        )));
    }

    resp.json::<SearchResponse>()
        .await
        .map_err(|e| AppError::ExternalCommand(format!("modrinth search parse: {e}")))
}

/// Fetch a single project by slug or ID.
pub async fn get_project(client: &Client, id_or_slug: &str) -> Result<ModrinthProject> {
    let url = format!("{BASE_URL}/project/{}", urlencoding::encode(id_or_slug));
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::ExternalCommand(format!("modrinth get_project: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        return Err(AppError::ExternalCommand(format!(
            "modrinth get_project({id_or_slug}) returned {status}"
        )));
    }

    resp.json::<ModrinthProject>()
        .await
        .map_err(|e| AppError::ExternalCommand(format!("modrinth get_project parse: {e}")))
}

/// Fetch all versions compatible with paper loaders and 1.21.x.
pub async fn get_versions(client: &Client, id_or_slug: &str) -> Result<Vec<ModrinthVersion>> {
    let loaders_json = serde_json::to_string(LOADERS).unwrap_or_default();
    let game_versions = r#"["1.21","1.21.1","1.21.2","1.21.3","1.21.4"]"#;
    let url = format!(
        "{BASE_URL}/project/{}/version?loaders={}&game_versions={}",
        urlencoding::encode(id_or_slug),
        urlencoding::encode(&loaders_json),
        urlencoding::encode(game_versions),
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::ExternalCommand(format!("modrinth get_versions: {e}")))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(vec![]);
    }

    if !resp.status().is_success() {
        let status = resp.status();
        return Err(AppError::ExternalCommand(format!(
            "modrinth get_versions({id_or_slug}) returned {status}"
        )));
    }

    let versions: Vec<ModrinthVersion> = resp
        .json()
        .await
        .map_err(|e| AppError::ExternalCommand(format!("modrinth get_versions parse: {e}")))?;

    // Filter: must have at least one compatible loader and one 1.21.x game version.
    let filtered = versions
        .into_iter()
        .filter(|v| {
            let has_loader = v
                .loaders
                .iter()
                .any(|l| LOADERS.contains(&l.as_str()));
            let has_version = v
                .game_versions
                .iter()
                .any(|gv| COMPAT_VERSIONS.iter().any(|prefix| gv.starts_with(prefix)));
            has_loader && has_version
        })
        .collect();

    Ok(filtered)
}

/// Return the latest compatible version (most recently published).
pub async fn get_latest_compatible_version(
    client:     &Client,
    id_or_slug: &str,
) -> Result<Option<ModrinthVersion>> {
    let mut versions = get_versions(client, id_or_slug).await?;
    if versions.is_empty() {
        return Ok(None);
    }
    // Sort by date_published descending; newest first.
    versions.sort_by(|a, b| b.date_published.cmp(&a.date_published));
    Ok(versions.into_iter().next())
}
