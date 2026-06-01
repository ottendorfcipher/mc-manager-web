//! Plugin health monitoring — log parsing and reconciliation.

use sqlx::SqlitePool;
use tracing::warn;

use crate::{
    config::Config,
    db::{installed_plugins, plugin_health},
};

const PLUGINS_DIR: &str = "/opt/minecraft/server/plugins";

/// Reconcile the installed_plugins table with what's actually on disk.
/// Uses SSH + python to extract plugin.yml from each jar.
pub async fn reconcile_installed(pool: &SqlitePool, cfg: &Config) -> anyhow::Result<()> {
    // List all .jar files in the plugins dir.
    let list_cmd = format!(
        "find '{PLUGINS_DIR}' -maxdepth 1 -name '*.jar' -exec bash -c \
         'echo \"FILE:$1\"; python3 -c \
         \"import zipfile,sys;\
           z=zipfile.ZipFile(sys.argv[1]);\
           data=z.read(\\\"plugin.yml\\\").decode(errors=\\\"replace\\\");\
           print(data)\" \
         \"$1\" 2>/dev/null; echo \"---END---\"' _ {{}} \\;"
    );

    let (stdout, _) = crate::gcloud::ssh::run_with_timeout(
        cfg,
        &list_cmd,
        std::time::Duration::from_secs(60),
    )
    .await
    .unwrap_or_default();

    // Parse sections separated by ---END---
    let sections: Vec<&str> = stdout.split("---END---").collect();
    for section in sections {
        let section = section.trim();
        if section.is_empty() {
            continue;
        }

        // Extract filename from FILE: line.
        let lines: Vec<&str> = section.lines().collect();
        let file_line = lines.first().unwrap_or(&"");
        if !file_line.starts_with("FILE:") {
            continue;
        }
        let full_path = file_line.trim_start_matches("FILE:").trim();
        let filename = full_path.rsplit('/').next().unwrap_or(full_path).to_string();

        // The rest is the plugin.yml content.
        let yml_content = lines[1..].join("\n");
        let meta = crate::minecraft::plugin_jar::read_plugin_meta(yml_content.as_bytes()).ok();

        let _ = installed_plugins::upsert(
            pool,
            &filename,
            None,
            meta.as_ref().map(|m| m.name.as_str()),
            meta.as_ref().map(|m| m.version.as_str()),
            meta.as_ref().and_then(|m| m.api_version.as_deref()),
            &meta.as_ref()
                .map(|m| serde_json::to_string(&m.depends).unwrap_or_default())
                .unwrap_or_else(|| "[]".into()),
            &meta.as_ref()
                .map(|m| serde_json::to_string(&m.soft_depends).unwrap_or_default())
                .unwrap_or_else(|| "[]".into()),
            None,
            0,
            "reconcile",
        )
        .await;
    }

    Ok(())
}

/// Parse a single Minecraft log line for plugin health events.
/// Returns `(plugin_name_or_filename, kind, detail)` if matched.
pub fn parse_health_line(line: &str) -> Option<(String, String, String)> {
    // "[HH:MM:SS] [Server thread/INFO]: [PluginName] Enabling PluginName v1.2.3"
    if let Some(pos) = line.find("] Enabling ") {
        let rest = &line[pos + "] Enabling ".len()..];
        let (name, version) = if let Some(v_pos) = rest.find(" v") {
            let n = rest[..v_pos].trim().to_string();
            let v = rest[v_pos + 2..].split_whitespace().next().unwrap_or("").to_string();
            (n, v)
        } else {
            (rest.split_whitespace().next().unwrap_or(rest).to_string(), String::new())
        };
        if !name.is_empty() {
            return Some((name, "loaded".into(), version));
        }
    }

    // "[HH:MM:SS] [Server thread/ERROR]: Could not load 'plugins/Foo.jar' in folder 'plugins'"
    if line.contains("ERROR") && line.contains("Could not load 'plugins/") {
        if let Some(start) = line.find("'plugins/") {
            let rest = &line[start + 1..]; // remove leading '
            let end = rest.find('\'').unwrap_or(rest.len());
            let path = &rest[..end]; // "plugins/Foo.jar"
            let filename = path.rsplit('/').next().unwrap_or(path).to_string();
            let detail = rest[end..]
                .trim_start_matches('\'')
                .trim()
                .to_string();
            return Some((filename, "load_error".into(), detail));
        }
    }

    // "[HH:MM:SS] [Server thread/ERROR]: Error occurred while enabling PluginName"
    if line.contains("ERROR") && line.contains("Error occurred while enabling ") {
        if let Some(pos) = line.find("Error occurred while enabling ") {
            let rest = &line[pos + "Error occurred while enabling ".len()..];
            let name = rest.split_whitespace().next().unwrap_or(rest).to_string();
            if !name.is_empty() {
                return Some((name, "runtime_error".into(), "Error during enable".into()));
            }
        }
    }

    None
}

/// Process a log line from the chat watcher: detect health events and persist them.
pub async fn process_log_line(pool: &SqlitePool, line: &str) {
    if let Some((name, kind, detail)) = parse_health_line(line) {
        let raw = if line.len() > 500 { &line[..500] } else { line };

        // Update installed_plugins health status by declared name or filename.
        let new_status = match kind.as_str() {
            "loaded"        => "running",
            "load_error"    => "errored",
            "runtime_error" => "errored",
            _               => "unknown",
        };

        // Try to find plugin by declared_name first, then filename.
        let plugins = installed_plugins::list(pool).await.unwrap_or_default();
        for plugin in &plugins {
            let matches = plugin.declared_name.as_deref() == Some(&name)
                || plugin.filename == name;
            if matches {
                if let Err(e) = installed_plugins::set_health(pool, &plugin.filename, new_status).await {
                    warn!("plugin_health: set_health failed for {}: {e}", plugin.filename);
                }
                let _ = plugin_health::insert_event(
                    pool,
                    Some(&plugin.filename),
                    &kind,
                    &detail,
                    Some(raw),
                ).await;
                return;
            }
        }

        // If no match found, still log the event without filename linkage.
        let _ = plugin_health::insert_event(pool, None, &kind, &detail, Some(raw)).await;
    }
}
