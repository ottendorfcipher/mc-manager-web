use std::time::Duration;
use std::process::Stdio;
use tokio_util::io::ReaderStream;

use crate::{
    config::Config,
    db::backups,
    error::{AppError, Result},
    gcloud::ssh,
};

const BACKUP_SCRIPT: &str = "/opt/minecraft/backup.sh";
const REMOTE_MINECRAFT_DIR: &str = "/opt/minecraft";

/// SSH constants (mirrors gcloud/ssh.rs so we can spawn raw processes for streaming)
const MC_SSH_KEY: &str = "/opt/redstonecipher/mc_ssh_key";
const MC_KNOWN_HOSTS: &str = "/opt/redstonecipher/mc_known_hosts";

// ── Public API ────────────────────────────────────────────────────────────────

/// Scan the backup directory on mc-server-1 and register any previously-unseen
/// archives in the database. Returns the number of newly inserted rows.
/// Non-fatal: if the MC server is unreachable the error is logged and 0 is returned.
pub async fn sync_into_db(pool: &sqlx::SqlitePool, cfg: &Config) -> usize {
    match sync_into_db_inner(pool, cfg).await {
        Ok(n) => n,
        Err(e) => {
            tracing::warn!(error = %e, "Could not sync backups from mc-server-1 (is it online?)");
            0
        }
    }
}

async fn sync_into_db_inner(pool: &sqlx::SqlitePool, cfg: &Config) -> Result<usize> {
    // GNU find on Debian: %f = filename, %s = size bytes, %T@ = mtime epoch seconds
    let cmd = format!(
        "find '{dir}' -maxdepth 1 -name '*.tar.gz' -type f \
         -printf '%f\\t%s\\t%TY-%Tm-%TdT%TH:%TM:00Z\\n'",
        dir = cfg.mc_backup_dir
    );
    let (stdout, _) = ssh::run_with_timeout(cfg, &cmd, Duration::from_secs(20)).await?;

    let mut count = 0usize;
    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() != 3 { continue; }
        let filename   = parts[0];
        let size_bytes: i64 = parts[1].parse().unwrap_or(0);
        let created_at = parts[2];
        let remote_path = format!("{}/{}", cfg.mc_backup_dir, filename);

        if backups::exists_by_filename(pool, filename).await? {
            continue;
        }

        // Use the date portion of the filename as created_by label if we can.
        backups::insert(pool, filename, &remote_path, size_bytes, "mc-server-1").await?;

        // Patch the created_at to the mtime we got from find (the INSERT default is NOW)
        sqlx::query("UPDATE backup_runs SET created_at = ? WHERE filename = ?")
            .bind(created_at)
            .bind(filename)
            .execute(pool)
            .await?;

        count += 1;
    }
    Ok(count)
}

/// Trigger `/opt/minecraft/scripts/backup.sh` on mc-server-1, wait for it to
/// finish, then return the filename of the newest archive in the backup dir.
pub async fn create(cfg: &Config) -> Result<String> {
    // Run the backup script (uses RCON to flush saves; does NOT stop the server)
    let cmd = format!(
        "bash '{BACKUP_SCRIPT}' && \
         ls -t '{dir}'/*.tar.gz 2>/dev/null | head -1",
        dir = cfg.mc_backup_dir
    );
    let (stdout, _) = ssh::run_with_timeout(cfg, &cmd, Duration::from_secs(180)).await?;

    // stdout is the full remote path of the newest backup
    let remote_path = stdout.trim();
    if remote_path.is_empty() {
        return Err(AppError::ExternalCommand(
            "Backup script ran but no archive found in backup dir".into()
        ));
    }
    // Extract just the filename from the path
    let filename = remote_path
        .rsplit('/')
        .next()
        .unwrap_or(remote_path)
        .to_string();
    Ok(filename)
}

/// Stream the content of a remote backup file over SSH.
/// The returned stream yields raw bytes from `cat <remote_path>`.
/// The caller is responsible for building the HTTP response body.
pub fn stream_file(
    cfg: &Config,
    remote_path: &str,
) -> Result<ReaderStream<tokio::process::ChildStdout>> {
    let dest = format!("root@{}", cfg.tailscale_ip);
    // Escape single quotes in path (POSIX shell idiom)
    let safe_path = remote_path.replace('\'', "'\\''" );
    let cat_cmd = format!("cat '{safe_path}'");

    let mut child = tokio::process::Command::new("ssh")
        .args([
            "-i", MC_SSH_KEY,
            "-o", "StrictHostKeyChecking=yes",
            "-o", &format!("UserKnownHostsFile={MC_KNOWN_HOSTS}"),
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=10",
            &dest,
            &cat_cmd,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| AppError::ExternalCommand(e.to_string()))?;

    let stdout = child.stdout.take()
        .ok_or_else(|| AppError::ExternalCommand("SSH stdout unavailable".into()))?;

    // Reap the child when it completes so we don't accumulate zombies
    tokio::spawn(async move { let _ = child.wait().await; });

    Ok(ReaderStream::new(stdout))
}

/// Delete a backup archive from mc-server-1.
pub async fn delete_remote(cfg: &Config, remote_path: &str) -> Result<()> {
    let safe_path = remote_path.replace('\'', "'\\''" );
    let cmd = format!("rm -f '{safe_path}'");
    // Non-fatal: log but don't fail if the file is already gone
    if let Err(e) = ssh::run(cfg, &cmd).await {
        tracing::warn!(path = %remote_path, error = %e, "Could not remove backup from mc-server-1");
    }
    Ok(())
}

/// Restore a backup that lives on mc-server-1.
/// Stops the server, wipes world dirs, extracts the archive in-place, restarts.
pub async fn restore(cfg: &Config, remote_path: &str) -> Result<()> {
    let safe_path = remote_path.replace('\'', "'\\''" );
    let restore_cmd = format!(
        "sudo systemctl stop minecraft && \
         sudo rm -rf {REMOTE_MINECRAFT_DIR}/world \
                     {REMOTE_MINECRAFT_DIR}/world_nether \
                     {REMOTE_MINECRAFT_DIR}/world_the_end && \
         sudo tar -xzf '{safe_path}' -C {REMOTE_MINECRAFT_DIR} && \
         sudo chown -R minecraft:minecraft {REMOTE_MINECRAFT_DIR} && \
         sudo systemctl start minecraft && echo DONE"
    );
    let (out, _) = ssh::run_with_timeout(cfg, &restore_cmd, Duration::from_secs(180)).await?;
    if !out.contains("DONE") {
        return Err(AppError::ExternalCommand("Restore did not complete cleanly".into()));
    }
    Ok(())
}

