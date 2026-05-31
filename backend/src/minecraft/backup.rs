use std::process::Stdio;
use std::time::Duration;
use tokio_util::io::ReaderStream;

use crate::{
    config::Config,
    db::backups,
    error::{AppError, Result},
    gcloud::ssh,
    minecraft::world_switch,
};

const BACKUP_SCRIPT: &str = "/opt/minecraft/backup.sh";
const REMOTE_MINECRAFT_DIR: &str = "/opt/minecraft";

/// How many auto-created (cron) backups to keep per scope.  Each world
/// counts as its own scope, plus a separate "__GLOBAL__" bucket for
/// scope-less legacy archives.  User-initiated backups (anything with
/// `created_by != 'mc-server-1'`) are never pruned regardless of age.
const AUTO_BACKUP_KEEP_PER_SCOPE: i64 = 5;

/// After this many days, any surviving `.tar.gz` backup is recompressed
/// in-place on mc-server-1 to `.tar.xz`.  Same data, ~40% less disk —
/// a typical Minecraft world goes from ~300 MB gzip to ~180 MB xz -9.
/// `tar -xf` autodetects xz on restore so nothing else has to change.
const BACKUP_ARCHIVE_AFTER_DAYS: i64 = 7;

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
    // GNU find on Debian: %f = filename, %s = size bytes, %T@ = mtime epoch seconds.
    // Match both `.tar.gz` (fresh) and `.tar.xz` (archived) so a manually
    // dropped or sync-missed archive still gets registered.
    let cmd = format!(
        "find '{dir}' -maxdepth 1 -type f \
            \\( -name '*.tar.gz' -o -name '*.tar.xz' \\) \
         -printf '%f\\t%s\\t%TY-%Tm-%TdT%TH:%TM:00Z\\n'",
        dir = cfg.mc_backup_dir
    );
    let (stdout, _) = ssh::run_with_timeout(cfg, &cmd, Duration::from_secs(20)).await?;

    let mut count = 0usize;
    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() != 3 {
            continue;
        }
        let filename = parts[0];
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

    // After picking up any new archives, prune so we never keep more
    // than AUTO_BACKUP_KEEP_PER_SCOPE auto-generated ones per scope,
    // then archive whatever's left that's gotten older than the
    // archive-after threshold.
    prune_old_auto(pool, cfg).await;
    let pool_a = pool.clone();
    let cfg_a  = cfg.clone();
    // Archival can take several minutes per file (xz -9 on a ~300 MB
    // tar) — fire-and-forget so it doesn't stall startup / handlers.
    tokio::spawn(async move {
        archive_old(&pool_a, &cfg_a).await;
    });

    Ok(count)
}

/// Delete auto-generated backups (cron-created, `created_by = 'mc-server-1'`)
/// that fall outside the most-recent `AUTO_BACKUP_KEEP_PER_SCOPE` in
/// their scope (world_slug, or the global bucket).  User-initiated
/// backups are exempt and stay forever — they're the ones a human
/// explicitly asked for, presumably for a reason.
///
/// Best-effort: SSH failures while deleting individual archives are
/// logged but don't stop the sweep.  Returns the number of archives
/// successfully removed.
pub async fn prune_old_auto(pool: &sqlx::SqlitePool, cfg: &Config) -> usize {
    let candidates = match backups::list_pruneable(pool, AUTO_BACKUP_KEEP_PER_SCOPE).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "backup prune: could not list pruneable rows");
            return 0;
        }
    };
    let mut deleted = 0usize;
    for r in candidates {
        // Best-effort remote delete — if the file is already gone we
        // still want to drop the stale DB row so the UI stays accurate.
        let _ = delete_remote(cfg, &r.file_path).await;
        match backups::remove(pool, r.id).await {
            Ok(_)  => {
                deleted += 1;
                tracing::info!(
                    filename = %r.filename,
                    created_at = %r.created_at,
                    world_slug = ?r.world_slug,
                    "backup prune: removed auto-backup beyond retention window",
                );
            }
            Err(e) => tracing::warn!(error = %e, id = r.id, "backup prune: DB delete failed"),
        }
    }
    if deleted > 0 {
        tracing::info!("backup prune: removed {deleted} stale auto-backup(s)");
    }
    deleted
}

/// Recompress any `.tar.gz` backup older than `BACKUP_ARCHIVE_AFTER_DAYS`
/// to `.tar.xz` (xz -9, multi-threaded).  Runs entirely on mc-server-1
/// so we don't ship 300 MB over the wire.
///
/// Uses an atomic temp-file pattern: write to `<dest>.tmp`, verify it's
/// non-empty, move into place, then delete the original.  A torn xz pass
/// (host reboot, OOM kill) leaves the original `.tar.gz` untouched and
/// just litters a `.tmp` for the next run to clobber.
///
/// Best-effort: any single failure logs and continues with the next row.
pub async fn archive_old(pool: &sqlx::SqlitePool, cfg: &Config) -> usize {
    let candidates = match backups::list_archivable(pool, BACKUP_ARCHIVE_AFTER_DAYS).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "backup archive: could not list archivable rows");
            return 0;
        }
    };
    if candidates.is_empty() { return 0; }
    tracing::info!("backup archive: {} candidate(s) older than {BACKUP_ARCHIVE_AFTER_DAYS}d", candidates.len());

    let mut archived = 0usize;
    for r in candidates {
        let old_path = r.file_path.clone();
        let new_path = old_path.strip_suffix(".tar.gz")
            .map(|stem| format!("{stem}.tar.xz"));
        let Some(new_path) = new_path else {
            tracing::warn!(filename = %r.filename, "backup archive: unexpected extension, skipping");
            continue;
        };
        let new_filename = r.filename.strip_suffix(".tar.gz")
            .map(|stem| format!("{stem}.tar.xz"))
            .unwrap_or_else(|| r.filename.clone());

        // Recompress on the remote.  `xz -T 0` parallelises across cores;
        // `-9` is max compression.  `stat -c %s` prints the new file's
        // size so we can update the DB row.
        let safe_old = old_path.replace('\'', "'\\''");
        let safe_new = new_path.replace('\'', "'\\''");
        let cmd = format!(
            "TMP='{safe_new}.tmp' && \
             gunzip -c '{safe_old}' | xz -9 -T 0 -c > \"$TMP\" && \
             [ -s \"$TMP\" ] && \
             mv \"$TMP\" '{safe_new}' && \
             rm '{safe_old}' && \
             stat -c %s '{safe_new}'"
        );

        // Recompression of a multi-hundred-MB world tar can run minutes —
        // give it plenty of headroom.
        let out = ssh::run_with_timeout(cfg, &cmd, Duration::from_secs(900)).await;
        let new_size: i64 = match out {
            Ok((stdout, _)) => stdout.trim().parse().unwrap_or(0),
            Err(e) => {
                tracing::warn!(
                    filename = %r.filename,
                    error = %e,
                    "backup archive: recompress failed",
                );
                continue;
            }
        };
        if new_size <= 0 {
            tracing::warn!(filename = %r.filename, "backup archive: zero-byte result, refusing to swap");
            continue;
        }

        match backups::update_archive(pool, r.id, &new_filename, &new_path, new_size).await {
            Ok(_) => {
                let saved_pct = if r.size_bytes > 0 {
                    100 - (new_size * 100 / r.size_bytes)
                } else { 0 };
                tracing::info!(
                    old_filename = %r.filename,
                    new_filename = %new_filename,
                    old_size = r.size_bytes,
                    new_size,
                    saved_pct,
                    "backup archive: recompressed",
                );
                archived += 1;
            }
            Err(e) => tracing::warn!(error = %e, id = r.id, "backup archive: DB update failed (file already swapped on remote)"),
        }
    }
    if archived > 0 {
        tracing::info!("backup archive: recompressed {archived} backup(s)");
    }
    archived
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
            "Backup script ran but no archive found in backup dir".into(),
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
    let safe_path = remote_path.replace('\'', "'\\''");
    let cat_cmd = format!("cat '{safe_path}'");

    let mut child = tokio::process::Command::new("ssh")
        .args([
            "-i",
            MC_SSH_KEY,
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            &format!("UserKnownHostsFile={MC_KNOWN_HOSTS}"),
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            &dest,
            &cat_cmd,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| AppError::ExternalCommand(e.to_string()))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::ExternalCommand("SSH stdout unavailable".into()))?;

    // Reap the child when it completes so we don't accumulate zombies
    tokio::spawn(async move {
        let _ = child.wait().await;
    });

    Ok(ReaderStream::new(stdout))
}

/// Scan the backup directory for a specific world, registering any new archives
/// in the DB with world_id and world_slug set.
/// Non-fatal: SSH failures are logged and 0 is returned.
pub async fn sync_world_backup_into_db(
    pool: &sqlx::SqlitePool,
    cfg: &Config,
    world_id: i64,
    world_slug: &str,
) -> usize {
    match sync_world_backup_inner(pool, cfg, world_id, world_slug).await {
        Ok(n) => n,
        Err(e) => {
            tracing::warn!(
                world_slug,
                error = %e,
                "Could not sync world backups from mc-server-1"
            );
            0
        }
    }
}

async fn sync_world_backup_inner(
    pool: &sqlx::SqlitePool,
    cfg: &Config,
    world_id: i64,
    world_slug: &str,
) -> Result<usize> {
    let files = world_switch::list_world_backup_files(cfg, world_slug).await?;
    let mut count = 0usize;
    for (filename, remote_path, size_bytes, mtime) in files {
        if backups::exists_by_filename(pool, &filename).await? {
            continue;
        }
        backups::insert_for_world(
            pool,
            &filename,
            &remote_path,
            size_bytes,
            "mc-server-1",
            world_id,
            world_slug,
        )
        .await?;
        // Patch created_at to the file's actual mtime
        sqlx::query("UPDATE backup_runs SET created_at = ? WHERE filename = ?")
            .bind(&mtime)
            .bind(&filename)
            .execute(pool)
            .await?;
        count += 1;
    }

    // Same retention + archival rules apply per-world.
    prune_old_auto(pool, cfg).await;
    let pool_a = pool.clone();
    let cfg_a  = cfg.clone();
    tokio::spawn(async move { archive_old(&pool_a, &cfg_a).await; });

    Ok(count)
}

/// Delete a backup archive from mc-server-1.
pub async fn delete_remote(cfg: &Config, remote_path: &str) -> Result<()> {
    let safe_path = remote_path.replace('\'', "'\\''");
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
    let safe_path = remote_path.replace('\'', "'\\''");
    // `tar -xf` (no compression flag) lets GNU tar autodetect gzip,
    // xz, zstd, etc. — required so archived `.tar.xz` backups restore
    // the same way as the live `.tar.gz` ones.
    let restore_cmd = format!(
        "sudo systemctl stop minecraft && \
         sudo rm -rf {REMOTE_MINECRAFT_DIR}/world \
                     {REMOTE_MINECRAFT_DIR}/world_nether \
                     {REMOTE_MINECRAFT_DIR}/world_the_end && \
         sudo tar -xf '{safe_path}' -C {REMOTE_MINECRAFT_DIR} && \
         sudo chown -R minecraft:minecraft {REMOTE_MINECRAFT_DIR} && \
         sudo systemctl start minecraft && echo DONE"
    );
    let (out, _) = ssh::run_with_timeout(cfg, &restore_cmd, Duration::from_secs(180)).await?;
    if !out.contains("DONE") {
        return Err(AppError::ExternalCommand(
            "Restore did not complete cleanly".into(),
        ));
    }
    Ok(())
}
