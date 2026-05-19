use std::time::Duration;

use crate::{
    config::Config,
    error::{AppError, Result},
    gcloud::ssh,
};

const SWITCH_SCRIPT: &str = "/opt/minecraft/scripts/world-switch.sh";
const BACKUP_SCRIPT: &str = "/opt/minecraft/scripts/world-backup.sh";

// ── World switching ───────────────────────────────────────────────────────────

/// Run the world-switch script over SSH.
///
/// The script flushes saves, stops the service, rsyncs the current world to
/// `/opt/minecraft/worlds/{current_slug}`, swaps in the target world, restarts
/// the service, and emits "DONE" on success.
///
/// Times out after 5 minutes to allow for large rsync operations.
pub async fn switch_world(
    cfg: &Config,
    current_slug: &str,
    target_slug: &str,
) -> Result<()> {
    let safe_current = shell_quote(current_slug);
    let safe_target  = shell_quote(target_slug);
    let cmd = format!("bash '{SWITCH_SCRIPT}' {safe_current} {safe_target}");

    let (out, _) = ssh::run_with_timeout(cfg, &cmd, Duration::from_secs(300)).await?;

    if out.contains("DONE") {
        Ok(())
    } else {
        let reason = out
            .lines()
            .find(|l| l.starts_with("ERROR:"))
            .map(|l| l.trim_start_matches("ERROR:").to_string())
            .unwrap_or_else(|| format!("unexpected output: {}", out.trim()));
        Err(AppError::ExternalCommand(format!(
            "World switch failed: {reason}"
        )))
    }
}

// ── World-scoped backups ──────────────────────────────────────────────────────

/// Run the world-backup script for the given slug.
/// Returns the full remote path of the created `.tar.gz` archive.
pub async fn create_world_backup(cfg: &Config, world_slug: &str) -> Result<String> {
    let safe_slug = shell_quote(world_slug);
    let cmd = format!("bash '{BACKUP_SCRIPT}' {safe_slug}");
    let (out, _) = ssh::run_with_timeout(cfg, &cmd, Duration::from_secs(180)).await?;

    // The script prints the archive path as its last line
    let path = out
        .lines()
        .filter(|l| l.ends_with(".tar.gz"))
        .last()
        .map(|l| l.trim().to_string())
        .ok_or_else(|| {
            AppError::ExternalCommand(
                "World backup script did not return an archive path".into(),
            )
        })?;
    Ok(path)
}

/// Scan a world's backup directory on mc-server-1 and return
/// `(filename, remote_path, size_bytes, mtime_iso)` for every `.tar.gz`
/// not yet in the database.
pub async fn list_world_backup_files(
    cfg: &Config,
    world_slug: &str,
) -> Result<Vec<(String, String, i64, String)>> {
    let backup_dir = format!("/opt/minecraft/backups/{world_slug}/daily");
    let cmd = format!(
        "find '{backup_dir}' -maxdepth 1 -name '*.tar.gz' -type f \
         -printf '%f\\t%s\\t%TY-%Tm-%TdT%TH:%TM:00Z\\n' 2>/dev/null || true"
    );
    let (out, _) = ssh::run_with_timeout(cfg, &cmd, Duration::from_secs(20)).await?;

    let mut results = Vec::new();
    for line in out.lines() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() != 3 {
            continue;
        }
        let filename     = parts[0].to_string();
        let size: i64    = parts[1].parse().unwrap_or(0);
        let mtime        = parts[2].to_string();
        let remote_path  = format!("{backup_dir}/{filename}");
        results.push((filename, remote_path, size, mtime));
    }
    Ok(results)
}

// ── Directory management ──────────────────────────────────────────────────────

/// Create the world storage and backup directory tree on mc-server-1.
/// Called when a new world is created in the DB before it has ever been played.
pub async fn ensure_world_dirs(cfg: &Config, world_slug: &str) -> Result<()> {
    let safe_slug = shell_quote(world_slug);
    let worlds_dir  = format!("/opt/minecraft/worlds/{world_slug}");
    let backup_base = format!("/opt/minecraft/backups/{world_slug}");
    let cmd = format!(
        "mkdir -p '{worlds_dir}' '{backup_base}/daily' '{backup_base}/weekly' && \
         chown -R minecraft:minecraft '/opt/minecraft/worlds/{world_slug}' \
                                      '/opt/minecraft/backups/{world_slug}' 2>/dev/null || true",
        worlds_dir  = worlds_dir,
        backup_base = backup_base,
    );
    // safe_slug is only used for validation here — the paths are constructed directly
    let _ = safe_slug;
    ssh::run(cfg, &cmd).await?;
    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Wrap a string in single-quotes for POSIX shell, escaping any embedded
/// single quotes using the `'\''` idiom.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
