use axum::{extract::State, Json};
use serde::Serialize;

use crate::{
    auth::middleware::AuthUser,
    db::installed_plugins,
    error::{AppError, Result},
    minecraft::plugin_jar,
    state::AppState,
};

const PLUGIN_CACHE_DIR: &str = "/opt/redstonecipher/data/plugin-cache";
const PLUGINS_DIR:      &str = "/opt/minecraft/server/plugins";
const MC_SSH_KEY:       &str = "/opt/redstonecipher/mc_ssh_key";
const MC_KNOWN_HOSTS:   &str = "/opt/redstonecipher/mc_known_hosts";

#[derive(Debug, Serialize)]
pub struct UploadResult {
    pub filename:    String,
    pub name:        String,
    pub version:     String,
    pub api_version: Option<String>,
    pub warnings:    Vec<String>,
}

pub async fn upload(
    State(state): State<AppState>,
    actor: AuthUser,
    mut multipart: axum::extract::Multipart,
) -> Result<Json<UploadResult>> {
    let mut jar_bytes: Option<(Vec<u8>, String)> = None;

    while let Some(field) = multipart.next_field().await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        if field.name() == Some("jar") {
            let filename = field.file_name()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "plugin.jar".to_string());
            let bytes = field.bytes().await
                .map_err(|e| AppError::BadRequest(e.to_string()))?;
            jar_bytes = Some((bytes.to_vec(), filename));
        }
    }

    let (bytes, original_name) = jar_bytes
        .ok_or_else(|| AppError::BadRequest("Missing multipart field 'jar'".into()))?;

    if !original_name.to_lowercase().ends_with(".jar") {
        return Err(AppError::BadRequest(
            format!("'{}' is not a .jar file", original_name)
        ));
    }

    let meta = plugin_jar::read_plugin_meta(&bytes)
        .map_err(|e| AppError::BadRequest(format!("Cannot read plugin.yml: {e}")))?;

    tokio::fs::create_dir_all(PLUGIN_CACHE_DIR).await
        .map_err(|e| AppError::ExternalCommand(format!("create cache dir: {e}")))?;

    let sha_val  = plugin_jar::sha1_hex(&bytes);
    let size     = bytes.len() as i64;
    let filename = original_name.clone();
    let cache_path = format!("{PLUGIN_CACHE_DIR}/{filename}");

    tokio::fs::write(&cache_path, &bytes).await
        .map_err(|e| AppError::ExternalCommand(format!("write cache: {e}")))?;

    // SCP to plugins dir.
    let dest = format!("root@{}:{PLUGINS_DIR}/{filename}", state.config.tailscale_ip);
    let status = tokio::process::Command::new("scp")
        .args([
            "-i", MC_SSH_KEY,
            "-o", "StrictHostKeyChecking=yes",
            "-o", &format!("UserKnownHostsFile={MC_KNOWN_HOSTS}"),
            "-q",
            &cache_path,
            &dest,
        ])
        .status()
        .await
        .map_err(|e| AppError::ExternalCommand(format!("scp spawn: {e}")))?;

    if !status.success() {
        return Err(AppError::ExternalCommand(
            format!("SCP failed for {filename} (exit {:?})", status.code())
        ));
    }

    // Register in installed_plugins with project_key = NULL.
    let _ = installed_plugins::upsert(
        &state.pool,
        &filename,
        None,
        Some(&meta.name),
        Some(&meta.version),
        meta.api_version.as_deref(),
        &serde_json::to_string(&meta.depends).unwrap_or_else(|_| "[]".into()),
        &serde_json::to_string(&meta.soft_depends).unwrap_or_else(|_| "[]".into()),
        Some(&sha_val),
        size,
        &actor.email,
    ).await;

    let mut warnings: Vec<String> = vec![];
    if let Some(ref av) = meta.api_version {
        if av.starts_with("1.22") || av.starts_with("1.23") || av.starts_with("1.24") {
            warnings.push(format!(
                "This plugin targets api-version {av} which is newer than your server (1.21)"
            ));
        }
    }

    Ok(Json(UploadResult {
        filename,
        name:        meta.name,
        version:     meta.version,
        api_version: meta.api_version,
        warnings,
    }))
}
