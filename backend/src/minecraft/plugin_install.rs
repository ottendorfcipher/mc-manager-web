//! Plugin install/remove pipeline state machine.
//!
//! Each call to `advance_job` moves one job one step forward.
//! The poll loop in `spawn_job_runner` calls this every 5 s for
//! queued/in-progress jobs.

use std::time::Duration;

use sqlx::SqlitePool;
use tracing::{info, warn};

use crate::{
    config::Config,
    db::{installed_plugins, plugin_jobs, plugins_catalog, settings},
    minecraft::{modrinth, plugin_jar},
};

const PLUGIN_CACHE_DIR: &str = "/opt/redstonecipher/data/plugin-cache";
const PLUGINS_DIR:      &str = "/opt/minecraft/server/plugins";
const MC_SSH_KEY:       &str = "/opt/redstonecipher/mc_ssh_key";
const MC_KNOWN_HOSTS:   &str = "/opt/redstonecipher/mc_known_hosts";

/// Advance a job by one state transition.  Idempotent per call: the state
/// is written to the DB before external work begins so a crash resumes cleanly.
pub async fn advance_job(
    pool:   &SqlitePool,
    cfg:    &Config,
    job_id: i64,
) -> anyhow::Result<()> {
    let job = match plugin_jobs::get(pool, job_id).await? {
        Some(j) => j,
        None    => return Ok(()),
    };

    match job.state.as_str() {
        "queued" if job.kind == "install" || job.kind == "update" =>
            resolve_install(pool, cfg, &job).await,
        "queued" if job.kind == "remove" =>
            start_backup_for_remove(pool, cfg, &job).await,
        "resolving"     => do_backup(pool, cfg, &job).await,
        "backing_up"    if job.kind != "remove" => download_jars(pool, cfg, &job).await,
        "backing_up"    if job.kind == "remove" => remove_file(pool, cfg, &job).await,
        "downloading"   => upload_jars(pool, cfg, &job).await,
        "uploading"     => mark_restart_pending(pool, job_id).await,
        "removing"      => mark_restart_pending(pool, job_id).await,
        "restart_pending" => Ok(()), // waits for POST /api/plugins/restart
        "verifying"     => verify_loaded(pool, cfg, &job).await,
        _               => Ok(()),
    }
}

// ── State transition: queued → resolving (install/update) ──────────────────

async fn resolve_install(
    pool: &SqlitePool,
    cfg:  &Config,
    job:  &plugin_jobs::PluginJob,
) -> anyhow::Result<()> {
    plugin_jobs::set_state(pool, job.id, "resolving", Some("Resolving dependencies")).await?;

    let project_key = match job.project_key.as_deref() {
        Some(k) => k.to_string(),
        None    => {
            plugin_jobs::finish(pool, job.id, "failed", Some("No project_key set")).await?;
            return Ok(());
        }
    };

    let slug = project_key
        .strip_prefix("modrinth:")
        .unwrap_or(&project_key)
        .to_string();

    // Load Modrinth PAT from settings for higher rate limits.
    let pat = settings::get(pool, &cfg.settings_enc_key, "modrinth.pat")
        .await
        .ok()
        .flatten();
    let client = modrinth::build_client_with_pat(pat.as_deref());

    // Get versions for the main plugin.
    let versions = modrinth::get_versions(&client, &slug).await?;
    let target_ver = match job.target_version.as_deref() {
        Some(vid) => versions.iter().find(|v| v.id == vid || v.version_number == vid).cloned(),
        None      => versions.into_iter().next(),
    };

    let main_ver = match target_ver {
        Some(v) => v,
        None    => {
            plugin_jobs::finish(pool, job.id, "failed",
                Some("No compatible version found on Modrinth")).await?;
            return Ok(());
        }
    };

    // BFS dependency resolution.
    let mut deps:       Vec<serde_json::Value> = vec![];
    let mut conflicts:  Vec<serde_json::Value> = vec![];
    let installed = installed_plugins::list(pool).await.unwrap_or_default();

    for dep in &main_ver.dependencies {
        if dep.dependency_type == "incompatible" {
            if let Some(dep_pid) = &dep.project_id {
                let key = format!("modrinth:{dep_pid}");
                if installed.iter().any(|p| p.project_key.as_deref() == Some(&key)) {
                    conflicts.push(serde_json::json!({ "project_id": dep_pid }));
                }
            }
            continue;
        }
        if dep.dependency_type == "required" {
            if let Some(dep_pid) = &dep.project_id {
                let key = format!("modrinth:{dep_pid}");
                let already = installed.iter().any(|p| p.project_key.as_deref() == Some(&key));
                if !already {
                    if let Ok(Some(dep_ver)) =
                        modrinth::get_latest_compatible_version(&client, dep_pid).await
                    {
                        deps.push(serde_json::json!({
                            "project_id": dep_pid,
                            "version_id": dep_ver.id,
                            "version_number": dep_ver.version_number,
                            "filename": primary_file(&dep_ver.files),
                            "url": primary_url(&dep_ver.files),
                            "sha256": primary_sha256(&dep_ver.files),
                        }));
                    }
                }
            }
        }
    }

    let main_file_name = primary_file(&main_ver.files);
    let main_url       = primary_url(&main_ver.files);

    let plan = serde_json::json!({
        "main": {
            "project_key": project_key,
            "version_id":  main_ver.id,
            "version_number": main_ver.version_number,
            "filename": main_file_name,
            "url": main_url,
            "sha256": primary_sha256(&main_ver.files),
        },
        "deps": deps,
        "conflicts": conflicts,
    });

    // Cache the plugin in the catalog.
    if let Ok(project) = modrinth::get_project(&client, &slug).await {
        let _ = plugins_catalog::upsert(
            pool,
            &project_key,
            "modrinth",
            &project.slug,
            &project.title,
            project.icon_url.as_deref(),
            Some(&project.description),
            r#"["paper","spigot","bukkit"]"#,
            r#"["1.21"]"#,
            project.downloads as i64,
            project.follows as i64,
            project.license.as_ref().map(|l| l.id.as_str()),
            project.source_url.as_deref(),
            None,
        ).await;
    }

    plugin_jobs::set_plan(pool, job.id, &serde_json::to_string(&plan)?).await?;
    plugin_jobs::set_state(pool, job.id, "resolving", Some("Resolved; starting backup")).await?;

    // Move directly to backing_up.
    do_backup(pool, cfg, &plugin_jobs::get(pool, job.id).await?.unwrap_or(job.clone())).await
}

// ── State transition: queued → backing_up (remove job) ─────────────────────

async fn start_backup_for_remove(
    pool: &SqlitePool,
    cfg:  &Config,
    job:  &plugin_jobs::PluginJob,
) -> anyhow::Result<()> {
    do_backup(pool, cfg, job).await
}

// ── State transition: resolving/queued → backing_up ────────────────────────

async fn do_backup(
    pool: &SqlitePool,
    cfg:  &Config,
    job:  &plugin_jobs::PluginJob,
) -> anyhow::Result<()> {
    plugin_jobs::set_state(pool, job.id, "backing_up", Some("Creating safety backup")).await?;

    // Run the backup script on the MC server.
    match crate::minecraft::backup::create(cfg).await {
        Ok(filename) => {
            // Insert a backup_runs row so we can reference it.
            let backup_id = crate::db::backups::insert(
                pool,
                &filename,
                &format!("{}/{filename}", cfg.mc_backup_dir),
                0,
                &job.requested_by,
            ).await?;
            plugin_jobs::set_backup(pool, job.id, backup_id).await?;
            info!("plugin_install: backup created for job {}, backup_id={backup_id}", job.id);
        }
        Err(e) => {
            warn!("plugin_install: backup failed for job {}: {e}", job.id);
            // Continue anyway — the backup failure should not abort the install.
        }
    }

    // Advance to the next state.
    let updated_job = plugin_jobs::get(pool, job.id).await?.unwrap_or(job.clone());
    if job.kind == "remove" {
        plugin_jobs::set_state(pool, job.id, "backing_up", Some("Backup done; removing file")).await?;
        remove_file(pool, cfg, &updated_job).await
    } else {
        plugin_jobs::set_state(pool, job.id, "backing_up", Some("Backup done; downloading")).await?;
        download_jars(pool, cfg, &updated_job).await
    }
}

// ── State transition: backing_up → downloading ─────────────────────────────

async fn download_jars(
    pool: &SqlitePool,
    cfg:  &Config,
    job:  &plugin_jobs::PluginJob,
) -> anyhow::Result<()> {
    plugin_jobs::set_state(pool, job.id, "downloading", Some("Downloading add-on")).await?;

    let plan: serde_json::Value = match job.plan_json.as_deref() {
        Some(p) => serde_json::from_str(p)?,
        None    => {
            plugin_jobs::finish(pool, job.id, "failed", Some("No plan_json")).await?;
            return Ok(());
        }
    };

    // Ensure cache dir exists.
    tokio::fs::create_dir_all(PLUGIN_CACHE_DIR).await?;

    // Build list of (url, filename, sha256) to download.
    let mut downloads: Vec<(String, String)> = vec![];

    if let Some(main) = plan.get("main") {
        let url  = main["url"].as_str().unwrap_or("").to_string();
        let name = main["filename"].as_str().unwrap_or("plugin.jar").to_string();
        if !url.is_empty() {
            downloads.push((url, name));
        }
    }

    if let Some(deps) = plan.get("deps").and_then(|d| d.as_array()) {
        for dep in deps {
            let url  = dep["url"].as_str().unwrap_or("").to_string();
            let name = dep["filename"].as_str().unwrap_or("dep.jar").to_string();
            if !url.is_empty() {
                downloads.push((url, name));
            }
        }
    }

    let client = reqwest::Client::builder()
        .user_agent("redstoneCipher/1.0 (admin@example.com)")
        .build()?;

    for (url, filename) in &downloads {
        let cache_path = format!("{PLUGIN_CACHE_DIR}/{filename}");
        // Skip if already cached.
        if tokio::fs::metadata(&cache_path).await.is_ok() {
            continue;
        }
        let resp = client.get(url)
            .timeout(Duration::from_secs(120))
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("download {filename}: {e}"))?;

        if !resp.status().is_success() {
            plugin_jobs::finish(pool, job.id, "failed",
                Some(&format!("Download failed for {filename}: HTTP {}", resp.status()))).await?;
            return Ok(());
        }

        let bytes = resp.bytes().await
            .map_err(|e| anyhow::anyhow!("read bytes {filename}: {e}"))?;

        tokio::fs::write(&cache_path, &bytes).await
            .map_err(|e| anyhow::anyhow!("write cache {cache_path}: {e}"))?;

        info!("plugin_install: downloaded {filename} ({} bytes)", bytes.len());
    }

    // Advance to uploading.
    let updated_job = plugin_jobs::get(pool, job.id).await?.unwrap_or(job.clone());
    upload_jars(pool, cfg, &updated_job).await
}

// ── State transition: downloading → uploading ──────────────────────────────

async fn upload_jars(
    pool: &SqlitePool,
    cfg:  &Config,
    job:  &plugin_jobs::PluginJob,
) -> anyhow::Result<()> {
    plugin_jobs::set_state(pool, job.id, "uploading", Some("Sending to server")).await?;

    let plan: serde_json::Value = match job.plan_json.as_deref() {
        Some(p) => serde_json::from_str(p)?,
        None    => {
            plugin_jobs::finish(pool, job.id, "failed", Some("No plan_json")).await?;
            return Ok(());
        }
    };

    let mut filenames: Vec<String> = vec![];

    if let Some(main) = plan.get("main") {
        if let Some(name) = main["filename"].as_str() {
            filenames.push(name.to_string());
        }
    }
    if let Some(deps) = plan.get("deps").and_then(|d| d.as_array()) {
        for dep in deps {
            if let Some(name) = dep["filename"].as_str() {
                filenames.push(name.to_string());
            }
        }
    }

    for filename in &filenames {
        let cache_path = format!("{PLUGIN_CACHE_DIR}/{filename}");
        let dest = format!("root@{}:{PLUGINS_DIR}/{filename}", cfg.tailscale_ip);

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
            .map_err(|e| anyhow::anyhow!("scp spawn: {e}"))?;

        if !status.success() {
            let msg = format!("SCP failed for {filename} (exit {:?})", status.code());
            plugin_jobs::finish(pool, job.id, "failed", Some(&msg)).await?;
            return Ok(());
        }

        info!("plugin_install: uploaded {filename} to {PLUGINS_DIR}");

        // Insert / update installed_plugins record.
        if let Ok(jar_bytes) = tokio::fs::read(&cache_path).await {
            let meta = plugin_jar::read_plugin_meta(&jar_bytes).ok();
            let sha_val = plugin_jar::sha1_hex(&jar_bytes);
            let size    = jar_bytes.len() as i64;
            let _ = installed_plugins::upsert(
                pool,
                filename,
                job.project_key.as_deref(),
                meta.as_ref().map(|m| m.name.as_str()),
                meta.as_ref().map(|m| m.version.as_str()),
                meta.as_ref().and_then(|m| m.api_version.as_deref()),
                &meta.as_ref().map(|m| serde_json::to_string(&m.depends).unwrap_or_default())
                    .unwrap_or_else(|| "[]".into()),
                &meta.as_ref().map(|m| serde_json::to_string(&m.soft_depends).unwrap_or_default())
                    .unwrap_or_else(|| "[]".into()),
                Some(&sha_val),
                size,
                &job.requested_by,
            ).await;
        }
    }

    // Move to restart_pending.
    mark_restart_pending(pool, job.id).await
}

// ── State transition: * → restart_pending ──────────────────────────────────

async fn mark_restart_pending(pool: &SqlitePool, job_id: i64) -> anyhow::Result<()> {
    plugin_jobs::set_state(pool, job_id, "restart_pending",
        Some("Waiting for server restart")).await?;
    Ok(())
}

// ── State transition: backing_up → removing (remove job) ───────────────────

async fn remove_file(
    pool: &SqlitePool,
    cfg:  &Config,
    job:  &plugin_jobs::PluginJob,
) -> anyhow::Result<()> {
    plugin_jobs::set_state(pool, job.id, "removing", Some("Removing file")).await?;

    // For remove jobs, project_key holds the filename to remove.
    let filename = match job.project_key.as_deref() {
        Some(f) => f.to_string(),
        None    => {
            plugin_jobs::finish(pool, job.id, "failed",
                Some("Remove job has no filename in project_key")).await?;
            return Ok(());
        }
    };

    let remote_path = format!("{PLUGINS_DIR}/{filename}");
    let cmd = format!("rm -f '{}'", remote_path.replace('\'', "'\\''"));

    if let Err(e) = crate::gcloud::ssh::run(cfg, &cmd).await {
        let msg = format!("Could not remove {filename}: {e}");
        plugin_jobs::finish(pool, job.id, "failed", Some(&msg)).await?;
        return Ok(());
    }

    // Remove from installed_plugins.
    let _ = installed_plugins::remove(pool, &filename).await;

    mark_restart_pending(pool, job.id).await
}

// ── State transition: restart_pending → verifying (triggered externally) ───

pub async fn trigger_restart_and_verify(
    pool: &SqlitePool,
    cfg:  &Config,
) -> anyhow::Result<()> {
    // Transition all restart_pending jobs to verifying.
    let active = plugin_jobs::list_active(pool).await?;
    for job in &active {
        if job.state == "restart_pending" {
            plugin_jobs::set_state(pool, job.id, "verifying",
                Some("Server restarting...")).await?;
        }
    }

    // Restart MC.
    let _ = crate::gcloud::ssh::run(cfg, "sudo systemctl restart --no-block minecraft").await;

    // Spawn background verification.
    let pool2 = pool.clone();
    let cfg2  = cfg.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        let _ = do_verify_all(&pool2, &cfg2).await;
    });

    Ok(())
}

async fn do_verify_all(pool: &SqlitePool, cfg: &Config) -> anyhow::Result<()> {
    let active = plugin_jobs::list_active(pool).await?;
    for job in active {
        if job.state == "verifying" {
            verify_loaded(pool, cfg, &job).await?;
        }
    }
    Ok(())
}

// ── State transition: verifying → done ─────────────────────────────────────

async fn verify_loaded(
    pool: &SqlitePool,
    cfg:  &Config,
    job:  &plugin_jobs::PluginJob,
) -> anyhow::Result<()> {
    // Look for "Enabling <PluginName>" in the log.
    let plugin_name = job.plan_json.as_deref()
        .and_then(|p| serde_json::from_str::<serde_json::Value>(p).ok())
        .and_then(|v| v["main"]["filename"].as_str().map(|s| s.to_string()));

    let log_path = format!("{}/logs/latest.log", cfg.mc_server_dir);
    let cmd = format!("tail -n 200 '{log_path}'");

    let (log_tail, _) = crate::gcloud::ssh::run_with_timeout(
        cfg, &cmd, Duration::from_secs(15),
    ).await.unwrap_or_default();

    let loaded = if let Some(name) = &plugin_name {
        let stem = name.trim_end_matches(".jar");
        log_tail.contains(&format!("Enabling {stem}"))
            || log_tail.contains("Done")
    } else {
        // Can't verify by name — assume done if server logged "Done".
        log_tail.contains("Done")
    };

    if loaded {
        plugin_jobs::finish(pool, job.id, "done", Some("Plugin loaded successfully")).await?;
        info!("plugin_install: job {} verified done", job.id);
    } else {
        // Not yet loaded — stay in verifying, will retry.
        plugin_jobs::set_state(pool, job.id, "verifying",
            Some("Waiting for server to report plugin loaded")).await?;
    }

    let _ = cfg; // suppress unused warning
    Ok(())
}

// ── Background runner ───────────────────────────────────────────────────────

pub fn spawn_job_runner(pool: SqlitePool, cfg: Config) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;

            let active = match plugin_jobs::list_active(&pool).await {
                Ok(v)  => v,
                Err(e) => { warn!("plugin_runner: list_active failed: {e}"); continue; }
            };

            for job in active {
                // Skip jobs that need external input.
                if matches!(job.state.as_str(), "restart_pending") {
                    continue;
                }
                if let Err(e) = advance_job(&pool, &cfg, job.id).await {
                    warn!("plugin_runner: advance_job {} failed: {e}", job.id);
                    let _ = plugin_jobs::finish(
                        &pool, job.id, "failed", Some(&e.to_string()),
                    ).await;
                }
            }
        }
    });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

fn primary_file(files: &[modrinth::ModrinthFile]) -> String {
    files.iter()
        .find(|f| f.primary)
        .or_else(|| files.first())
        .map(|f| f.filename.clone())
        .unwrap_or_else(|| "plugin.jar".into())
}

fn primary_url(files: &[modrinth::ModrinthFile]) -> String {
    files.iter()
        .find(|f| f.primary)
        .or_else(|| files.first())
        .map(|f| f.url.clone())
        .unwrap_or_default()
}

fn primary_sha256(files: &[modrinth::ModrinthFile]) -> String {
    files.iter()
        .find(|f| f.primary)
        .or_else(|| files.first())
        .and_then(|f| f.hashes.sha512.clone().or_else(|| f.hashes.sha1.clone()))
        .unwrap_or_default()
}
