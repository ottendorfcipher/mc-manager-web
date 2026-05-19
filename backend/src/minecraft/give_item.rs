use std::time::Duration;

use crate::{
    config::Config,
    error::{AppError, Result},
    gcloud::ssh,
};

/// Give `count` of `item_id` to a player.
/// - If the player is **online**: uses RCON `give` (instant, no file modification).
/// - If the player is **offline**: SSHes to mc-server-1 and runs `give-item.py`
///   which modifies the player's NBT playerdata file directly.  The item
///   appears in the player's inventory the next time they open it.
///
/// `uuid` is only required for the offline path.
pub async fn give(
    cfg: &Config,
    ign: &str,
    uuid: Option<&str>,
    item_id: &str,
    count: u32,
    online: bool,
) -> Result<()> {
    // Normalise item id
    let item_id = if item_id.contains(':') {
        item_id.to_string()
    } else {
        format!("minecraft:{item_id}")
    };

    let count = count.max(1).min(64);

    if online {
        // RCON: give <ign> <item_id> <count>
        let mc_cmd = format!("give {ign} {item_id} {count}");
        let applied = ssh::fifo_command(cfg, &mc_cmd).await?;
        if !applied {
            // Server offline — fall back to NBT edit if we have a UUID
            if let Some(uuid) = uuid {
                return give_offline(cfg, uuid, &item_id, count).await;
            }
            return Err(AppError::BadRequest(
                "Server is offline and no UUID was provided for offline delivery".into(),
            ));
        }
    } else {
        let uuid = uuid.ok_or_else(|| {
            AppError::BadRequest("UUID is required to give items to an offline player".into())
        })?;
        give_offline(cfg, uuid, &item_id, count).await?;
    }

    Ok(())
}

async fn give_offline(cfg: &Config, uuid: &str, item_id: &str, count: u32) -> Result<()> {
    let venv_python = format!(
        "{}/venv/bin/python3",
        std::path::Path::new(&cfg.mc_scripts_dir)
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or("/opt/minecraft")
    );
    let safe_uuid = uuid.replace('\'', ""); // UUIDs contain only hex+dash
    let safe_item_id = item_id.replace('\'', ""); // item IDs: letters, :, _
    let cmd = format!(
        "'{python}' '{scripts}/give-item.py' '{uuid}' '{item}' '{count}'",
        python = venv_python,
        scripts = cfg.mc_scripts_dir,
        uuid = safe_uuid,
        item = safe_item_id,
        count = count,
    );

    // The NBT script needs to read, modify, and write the player data file.
    // SSH ConnectTimeout=10 handles unreachable servers; 45 s total gives the
    // Python script ample time to complete even on a loaded server.
    let (stdout, _) = ssh::run_with_timeout(cfg, &cmd, Duration::from_secs(45))
        .await
        .map_err(|e| AppError::ExternalCommand(format!("give-item.py: {e}")))?;

    if stdout.starts_with("ERROR") {
        return Err(AppError::BadRequest(stdout));
    }

    tracing::info!(ign = %uuid, item = %item_id, count = count, "gave item offline");
    Ok(())
}
