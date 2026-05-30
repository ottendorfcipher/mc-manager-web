//! Read per-player statistics from the Minecraft server's stats directory.
//!
//! Each player's stats live at `{world_dir}/stats/{uuid}.json` and follow
//! the standard Minecraft statistics format:
//!
//! ```json
//! { "stats": {
//!     "minecraft:custom":   { "minecraft:play_time": 123, ... },
//!     "minecraft:killed":   { "minecraft:zombie": 5, ... },
//!     "minecraft:killed_by": { ... },
//!     "minecraft:mined":    { ... },
//!     "minecraft:crafted":  { ... },
//!     "minecraft:used":     { ... },
//!     "minecraft:picked_up": { ... },
//!     "minecraft:broken":   { ... },
//!     "minecraft:dropped":  { ... }
//! }}
//! ```
//!
//! We return the raw JSON to the frontend; presentation is handled there.

use crate::{config::Config, error::Result, gcloud::ssh};

/// Read the raw stats JSON for a player by UUID.
/// Returns `None` if the file doesn't exist (player has never joined).
pub async fn read_stats(cfg: &Config, uuid: &str) -> Result<Option<serde_json::Value>> {
    let path = format!("/opt/minecraft/server/world/stats/{uuid}.json");
    let script = format!(
        "if [ -f '{path}' ]; then cat '{path}'; else echo '{{}}'; fi"
    );
    let (out, _) = ssh::run(cfg, &script).await?;
    if out.trim() == "{}" {
        return Ok(None);
    }
    match serde_json::from_str::<serde_json::Value>(&out) {
        Ok(v) => Ok(Some(v)),
        Err(e) => {
            tracing::warn!("player_stats: failed to parse stats for {uuid}: {e}");
            Ok(None)
        }
    }
}
