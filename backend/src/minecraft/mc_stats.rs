//! Read Minecraft per-player statistics from the server.
//!
//! Stats files live at `<mc_server_dir>/world/stats/<uuid>.json`.
//! Each file is a JSON object: `{ "stats": { "<category>": { "<stat>": <value> } }, ... }`
//!
//! Stat paths in this module use the format `<category>/<stat>`,
//! e.g. `"minecraft:mined/minecraft:diamond_ore"`.

use std::collections::HashMap;
use std::time::Duration;

use crate::{config::Config, error::Result, gcloud::ssh};

/// Per-player stats keyed by stat path.
pub type PlayerStats = HashMap<String, i64>;

/// All players' stats keyed by UUID.
pub type AllPlayerStats = HashMap<String, (String, PlayerStats)>; // uuid -> (ign, stats)

/// Fetch stats for all players from mc-server-1.
///
/// Runs a single SSH command that reads the usercache (for uuid→ign mapping)
/// and all stats files, emitting a compact JSON blob.
pub async fn fetch_all_stats(cfg: &Config) -> Result<AllPlayerStats> {
    // Script: iterate stats dir, output JSON.  We keep it in a single SSH call
    // for efficiency.  The output format is a JSON array of objects:
    //   [{"uuid":"...","stats":{...}}, ...]
    let script = format!(
        r#"python3 -c "
import json, os, sys

server = '{server}'
cache_path = os.path.join(server, 'usercache.json')
stats_dir  = os.path.join(server, 'world', 'stats')

# uuid -> ign
ign_map = {{}}
try:
    with open(cache_path) as f:
        for e in json.load(f):
            ign_map[e.get('uuid','')] = e.get('name','')
except:
    pass

results = []
if os.path.isdir(stats_dir):
    for fname in os.listdir(stats_dir):
        if not fname.endswith('.json'):
            continue
        uuid = fname[:-5]
        try:
            with open(os.path.join(stats_dir, fname)) as f:
                data = json.load(f)
            results.append({{
                'uuid': uuid,
                'ign': ign_map.get(uuid, uuid),
                'stats': data.get('stats', {{}})
            }})
        except:
            pass

print(json.dumps(results))
""#,
        server = cfg.mc_server_dir,
    );

    let (stdout, _) = ssh::run_with_timeout(cfg, &script, Duration::from_secs(30)).await?;

    if stdout.trim().is_empty() || stdout.trim() == "[]" {
        return Ok(HashMap::new());
    }

    let raw: Vec<RawPlayerStats> = serde_json::from_str(&stdout).map_err(|e| {
        crate::error::AppError::ExternalCommand(format!("mc_stats parse: {e}"))
    })?;

    let mut result = HashMap::new();
    for player in raw {
        let mut flat: PlayerStats = HashMap::new();
        for (category, stats) in &player.stats {
            if let Some(obj) = stats.as_object() {
                for (stat_name, value) in obj {
                    let path = format!("{category}/{stat_name}");
                    if let Some(v) = value.as_i64() {
                        flat.insert(path, v);
                    }
                }
            }
        }
        result.insert(player.uuid, (player.ign, flat));
    }

    Ok(result)
}

/// Look up a specific stat value from a player's flat stats map.
/// Stat paths from `mc_paths` JSON array are summed.
pub fn resolve_stat(player_stats: &PlayerStats, mc_paths_json: &str) -> i64 {
    let paths: Vec<String> = serde_json::from_str(mc_paths_json).unwrap_or_default();
    paths
        .iter()
        .map(|p| player_stats.get(p.as_str()).copied().unwrap_or(0))
        .sum()
}

#[derive(serde::Deserialize)]
struct RawPlayerStats {
    uuid:  String,
    ign:   String,
    stats: HashMap<String, serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_stat_sums_multiple_paths() {
        let mut stats = PlayerStats::new();
        stats.insert("minecraft:mined/minecraft:diamond_ore".into(), 10);
        stats.insert("minecraft:mined/minecraft:deepslate_diamond_ore".into(), 5);

        let mc_paths = r#"["minecraft:mined/minecraft:diamond_ore","minecraft:mined/minecraft:deepslate_diamond_ore"]"#;
        assert_eq!(resolve_stat(&stats, mc_paths), 15);
    }

    #[test]
    fn resolve_stat_missing_returns_zero() {
        let stats = PlayerStats::new();
        let mc_paths = r#"["minecraft:custom/minecraft:mob_kills"]"#;
        assert_eq!(resolve_stat(&stats, mc_paths), 0);
    }

    #[test]
    fn resolve_stat_single_path() {
        let mut stats = PlayerStats::new();
        stats.insert("minecraft:custom/minecraft:player_kills".into(), 42);
        let mc_paths = r#"["minecraft:custom/minecraft:player_kills"]"#;
        assert_eq!(resolve_stat(&stats, mc_paths), 42);
    }

    #[test]
    fn resolve_stat_survival_ticks() {
        let mut stats = PlayerStats::new();
        // time_since_death is in game ticks (20 ticks = 1 second)
        stats.insert("minecraft:custom/minecraft:time_since_death".into(), 72000);
        let mc_paths = r#"["minecraft:custom/minecraft:time_since_death"]"#;
        // 72000 ticks = 3600 seconds = 1 hour
        assert_eq!(resolve_stat(&stats, mc_paths), 72000);
    }
}
