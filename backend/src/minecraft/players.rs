use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{config::Config, error::Result, gcloud::ssh};

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct McPlayer {
    pub ign: String,
    pub uuid: String,
    pub online: bool,
}

/// Fetch all players from usercache.json + latest.log online detection.
/// The echo-separator trick prevents JSON and =ONLINE= merging on one line.
pub async fn fetch_all(cfg: &Config) -> Result<Vec<McPlayer>> {
    let script = concat!(
        "echo '=CACHE=' && cat /opt/minecraft/usercache.json 2>/dev/null || echo '[]'; ",
        "echo; ",   // <-- blank line prevents JSON + =ONLINE= merging
        "echo '=ONLINE=' && ",
        "grep -E '(joined the game|left the game)' /opt/minecraft/logs/latest.log 2>/dev/null ",
        "  | tail -100"
    );

    let (out, _) = ssh::run(cfg, script).await?;
    Ok(parse_output(&out))
}

#[derive(Deserialize)]
struct CacheEntry {
    uuid: String,
    name: String,
}

fn parse_output(output: &str) -> Vec<McPlayer> {
    let mut cache_json = String::new();
    let mut online: std::collections::HashSet<String> = Default::default();
    let mut section = "";

    for line in output.lines() {
        let s = line.trim();
        match s {
            "=CACHE=" => { section = "cache"; cache_json.clear(); }
            "=ONLINE=" => {
                section = "online";
            }
            _ if section == "cache" => cache_json.push_str(s),
            _ if section == "online" && !s.is_empty() => {
                if s.contains("joined the game") {
                    if let Some(name) = extract_player_name(s, "joined the game") {
                        online.insert(name);
                    }
                } else if s.contains("left the game") {
                    if let Some(name) = extract_player_name(s, "left the game") {
                        online.remove(&name);
                    }
                }
            }
            _ => {}
        }
    }

    let entries: Vec<CacheEntry> = serde_json::from_str(&cache_json).unwrap_or_default();
    entries
        .into_iter()
        .map(|e| McPlayer {
            online: online.contains(&e.name),
            ign: e.name,
            uuid: e.uuid,
        })
        .collect()
}

fn extract_player_name(line: &str, suffix: &str) -> Option<String> {
    line.rsplit("]: ")
        .next()?
        .strip_suffix(&format!(" {suffix}"))?
        .trim()
        .to_string()
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_usercache_and_online_log() {
        let output = r#"=CACHE=
[{"uuid":"abc","name":"Steve"},{"uuid":"def","name":"Alex"}]
=ONLINE=
[04:27:04] [Server thread/INFO]: Steve joined the game
[04:27:10] [Server thread/INFO]: Alex joined the game
[04:28:00] [Server thread/INFO]: Steve left the game"#;

        let players = parse_output(output);
        assert_eq!(players.len(), 2);
        let steve = players.iter().find(|p| p.ign == "Steve").unwrap();
        let alex  = players.iter().find(|p| p.ign == "Alex").unwrap();
        assert!(!steve.online);
        assert!(alex.online);
    }
}
