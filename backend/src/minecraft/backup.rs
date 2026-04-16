use std::{path::Path, time::Duration};
use chrono::Utc;
use tokio::process::Command;

use crate::{config::Config, error::{AppError, Result}, gcloud::ssh};

const REMOTE_MINECRAFT_DIR: &str = "/opt/minecraft";
const WORLD_DIRS: &[&str] = &["world", "world_nether", "world_the_end", "server.properties"];

/// Create a tar.gz backup, download it to local backup_dir, return filename.
pub async fn create(cfg: &Config) -> Result<String> {
    let ts = Utc::now().format("%Y%m%d-%H%M%S");
    let filename = format!("mc-world-{ts}.tar.gz");
    let remote_tmp = format!("/tmp/{filename}");

    // Stop, archive, start
    let archive_cmd = format!(
        "sudo systemctl stop minecraft && \
         sudo tar -czf {remote_tmp} -C {REMOTE_MINECRAFT_DIR} {dirs} 2>/dev/null && \
         sudo chown $(whoami):$(whoami) {remote_tmp} && \
         sudo systemctl start minecraft",
        remote_tmp = remote_tmp,
        dirs = WORLD_DIRS.join(" "),
    );

    ssh::run_with_timeout(cfg, &archive_cmd, Duration::from_secs(120)).await?;

    // SCP download
    let local_path = cfg.backup_dir.join(&filename);
    scp_download(cfg, &remote_tmp, &local_path).await?;

    // Clean up remote tmp
    let _ = ssh::run(cfg, &format!("rm -f {remote_tmp}")).await;

    Ok(filename)
}

/// Restore a previously downloaded backup archive.
pub async fn restore(cfg: &Config, file_path: &Path) -> Result<()> {
    let filename = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::BadRequest("Invalid backup file path".into()))?;

    let remote_tmp = format!("/tmp/{filename}");

    // Upload
    scp_upload(cfg, file_path, &remote_tmp).await?;

    // Stop, wipe, extract, restart
    let restore_cmd = format!(
        "sudo systemctl stop minecraft && \
         sudo rm -rf {REMOTE_MINECRAFT_DIR}/world \
                     {REMOTE_MINECRAFT_DIR}/world_nether \
                     {REMOTE_MINECRAFT_DIR}/world_the_end && \
         sudo tar -xzf {remote_tmp} -C {REMOTE_MINECRAFT_DIR} && \
         sudo chown -R minecraft:minecraft {REMOTE_MINECRAFT_DIR} && \
         sudo rm {remote_tmp} && \
         sudo systemctl start minecraft && echo DONE"
    );

    let (out, _) = ssh::run_with_timeout(cfg, &restore_cmd, Duration::from_secs(120)).await?;
    if !out.contains("DONE") {
        return Err(AppError::ExternalCommand("Restore did not complete cleanly".into()));
    }
    Ok(())
}

async fn scp_download(cfg: &Config, remote_src: &str, local_dest: &Path) -> Result<()> {
    let status = Command::new(&cfg.gcloud_bin)
        .args([
            "compute", "scp",
            &format!("{}:{}", cfg.gcp_instance, remote_src),
            local_dest.to_str().unwrap_or(""),
            &format!("--project={}", cfg.gcp_project),
            &format!("--zone={}", cfg.gcp_zone),
            "--tunnel-through-iap",
        ])
        .status()
        .await
        .map_err(|e| AppError::ExternalCommand(e.to_string()))?;

    if !status.success() {
        return Err(AppError::ExternalCommand("SCP download failed".into()));
    }
    Ok(())
}

async fn scp_upload(cfg: &Config, local_src: &Path, remote_dest: &str) -> Result<()> {
    let status = Command::new(&cfg.gcloud_bin)
        .args([
            "compute", "scp",
            local_src.to_str().unwrap_or(""),
            &format!("{}:{}", cfg.gcp_instance, remote_dest),
            &format!("--project={}", cfg.gcp_project),
            &format!("--zone={}", cfg.gcp_zone),
            "--tunnel-through-iap",
        ])
        .status()
        .await
        .map_err(|e| AppError::ExternalCommand(e.to_string()))?;

    if !status.success() {
        return Err(AppError::ExternalCommand("SCP upload failed".into()));
    }
    Ok(())
}
