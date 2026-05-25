use serde::Deserialize;
use std::time::Duration;

use crate::{
    config::Config,
    db::player_snapshots,
    error::{AppError, Result},
    gcloud::ssh,
};

// ── Raw JSON shape emitted by get-player-data.py ─────────────────────────────

#[derive(Deserialize)]
struct RawItem {
    id: String,
    count: i64,
    slot: i64,
}

#[derive(Deserialize)]
struct RawSnapshot {
    uuid: String,
    ign: String,
    x: f64,
    y: f64,
    z: f64,
    yaw: f64,
    dimension: String,
    health: f64,
    inventory: Vec<RawItem>,
    // errors from the extractor are non-fatal; we still upsert what we got
    #[serde(default)]
    error: Option<String>,
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Flush playerdata on the Minecraft server (RCON save-all flush), then run
/// the Python extractor via SSH, parse the JSON output, upsert every player
/// into `player_snapshots`, and write BlueMap live `players.json` files.
///
/// Returns the number of rows upserted.
pub async fn refresh_snapshots(pool: &sqlx::SqlitePool, cfg: &Config) -> Result<usize> {
    // 1. Flush playerdata to disk so reads are current
    let _ = ssh::fifo_command(cfg, "save-all flush").await;

    // 2. Run the Python extractor on mc-server-1
    // mc_scripts_dir = /opt/minecraft/scripts → venv is /opt/minecraft/venv
    let venv_python = format!(
        "{}/venv/bin/python3",
        std::path::Path::new(&cfg.mc_scripts_dir)
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or("/opt/minecraft")
    );
    let cmd = format!(
        "'{python}' '{scripts}/get-player-data.py' '{world}'",
        python = venv_python,
        scripts = cfg.mc_scripts_dir,
        world = cfg.mc_server_dir.trim_end_matches('/').to_owned() + "/world",
    );

    let (stdout, _) = ssh::run_with_timeout(cfg, &cmd, Duration::from_secs(30))
        .await
        .map_err(|e| AppError::ExternalCommand(format!("player-data extractor: {e}")))?;

    if stdout.trim().is_empty() || stdout.trim() == "[]" {
        return Ok(0);
    }

    // 3. Parse
    let snapshots: Vec<RawSnapshot> = serde_json::from_str(&stdout).map_err(|e| {
        AppError::ExternalCommand(format!("player-data parse: {e} — raw: {stdout}"))
    })?;

    // 4. Upsert each player
    let mut count = 0usize;
    for s in &snapshots {
        if let Some(ref err) = s.error {
            tracing::warn!(ign = %s.ign, error = %err, "player-data extractor partial error");
        }
        let inv_json = serde_json::to_string(
            &s.inventory
                .iter()
                .map(|i| {
                    serde_json::json!({
                        "id":    i.id,
                        "count": i.count,
                        "slot":  i.slot,
                    })
                })
                .collect::<Vec<_>>(),
        )
        .unwrap_or_else(|_| "[]".into());

        player_snapshots::upsert(
            pool,
            &s.uuid,
            &s.ign,
            s.x,
            s.y,
            s.z,
            s.yaw,
            &s.dimension,
            &inv_json,
            s.health,
        )
        .await?;
        count += 1;
    }

    // 5. Write BlueMap live players.json for each dimension so player markers
    //    appear in the BlueMap webapp without a plugin.
    write_bluemap_players(cfg, &snapshots).await;

    Ok(count)
}

// ── BlueMap live player markers ───────────────────────────────────────────────

/// Tracks whether we've already warned about bluemap write failures so the
/// log isn't flooded every 5 seconds.
static BLUEMAP_WARNED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

async fn write_bluemap_players(cfg: &Config, snapshots: &[RawSnapshot]) {
    let dim_map = [
        ("minecraft:overworld", "overworld"),
        ("minecraft:the_nether", "nether"),
        ("minecraft:the_end", "end"),
    ];

    for (mc_dim, map_id) in dim_map {
        let players_in_dim: Vec<serde_json::Value> = snapshots
            .iter()
            .filter(|s| s.dimension == mc_dim)
            .map(|s| {
                serde_json::json!({
                    "uuid":     s.uuid,
                    "name":     s.ign,
                    "foreign":  false,
                    "position": {"x": s.x, "y": s.y, "z": s.z},
                    "rotation": {"pitch": 0.0, "yaw": s.yaw},
                    "world":    mc_dim,
                })
            })
            .collect();

        let payload = serde_json::json!({ "players": players_in_dim });
        let dir = format!("{}/maps/{}/live", cfg.map_tiles_dir, map_id);
        let path = format!("{}/players.json", dir);

        if let Err(e) = std::fs::create_dir_all(&dir) {
            if !BLUEMAP_WARNED.swap(true, std::sync::atomic::Ordering::Relaxed) {
                tracing::warn!("bluemap live dir: {e} (further warnings suppressed)");
            }
            continue;
        }
        if let Err(e) = std::fs::write(&path, payload.to_string()) {
            if !BLUEMAP_WARNED.swap(true, std::sync::atomic::Ordering::Relaxed) {
                tracing::warn!("bluemap players.json write: {e} (further warnings suppressed)");
            }
        }
    }
}
