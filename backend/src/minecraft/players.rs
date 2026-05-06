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
/// Paths are derived from `cfg.mc_server_dir` so they stay correct if the
/// Minecraft install is ever moved.
pub async fn fetch_all(cfg: &Config) -> Result<Vec<McPlayer>> {
    let usercache = format!("{}/usercache.json",   cfg.mc_server_dir);
    let log_path  = format!("{}/logs/latest.log",  cfg.mc_server_dir);

    let script = format!(
        "echo '=CACHE=' && cat '{usercache}' 2>/dev/null || echo '[]'; \
         echo; \
         echo '=ONLINE=' && \
         grep -E '(joined the game|left the game)' '{log_path}' 2>/dev/null | tail -100"
    );

    let (out, _) = ssh::run(cfg, &script).await?;
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
            "=CACHE=" => {
                section = "cache";
                cache_json.clear();
            }
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
        let alex = players.iter().find(|p| p.ign == "Alex").unwrap();
        assert!(!steve.online);
        assert!(alex.online);
    }

    #[test]
    fn empty_usercache_returns_empty_vec() {
        let output = "=CACHE=\n[]\n=ONLINE=\n";
        assert!(parse_output(output).is_empty());
    }

    #[test]
    fn invalid_usercache_json_returns_empty_vec() {
        let output = "=CACHE=\n{not valid json}\n=ONLINE=\n";
        assert!(parse_output(output).is_empty());
    }

    #[test]
    fn no_online_section_means_all_offline() {
        let output = "=CACHE=\n[{\"uuid\":\"abc\",\"name\":\"Steve\"}]\n";
        let players = parse_output(output);
        assert_eq!(players.len(), 1);
        assert!(!players[0].online);
    }

    #[test]
    fn player_join_then_leave_is_offline() {
        let output = concat!(
            "=CACHE=\n",
            "[{\"uuid\":\"abc\",\"name\":\"Steve\"}]\n",
            "=ONLINE=\n",
            "[10:00:00] [Server thread/INFO]: Steve joined the game\n",
            "[10:01:00] [Server thread/INFO]: Steve left the game\n",
        );
        let players = parse_output(output);
        assert!(
            !players[0].online,
            "player who joined then left should be offline"
        );
    }

    #[test]
    fn player_join_twice_stays_online() {
        // Duplicate join lines (e.g. server crash + rejoin) must keep them online
        let output = concat!(
            "=CACHE=\n",
            "[{\"uuid\":\"abc\",\"name\":\"Steve\"}]\n",
            "=ONLINE=\n",
            "[10:00:00] [Server thread/INFO]: Steve joined the game\n",
            "[10:00:30] [Server thread/INFO]: Steve joined the game\n",
        );
        let players = parse_output(output);
        assert!(players[0].online);
    }

    #[test]
    fn extract_player_name_basic() {
        let line = "[04:27:04] [Server thread/INFO]: Steve joined the game";
        assert_eq!(
            extract_player_name(line, "joined the game"),
            Some("Steve".to_string())
        );
    }

    #[test]
    fn extract_player_name_with_spaces_in_name() {
        // MC names cannot have spaces but this tests robustness
        let line = "[04:27:04] [Server thread/INFO]: left the game left the game";
        // Should match the trailing " left the game" suffix
        assert!(extract_player_name(line, "left the game").is_some());
    }

    #[test]
    fn extract_player_name_missing_delimiter_returns_none() {
        let line = "[04:27:04] [Server thread/INFO]: some other log line";
        assert_eq!(extract_player_name(line, "joined the game"), None);
    }

    #[test]
    fn usercache_uuid_and_ign_preserved() {
        let output = concat!(
            "=CACHE=\n",
            "[{\"uuid\":\"550e8400-e29b-41d4-a716-446655440000\",\"name\":\"Notch\"}]\n",
            "=ONLINE=\n",
        );
        let players = parse_output(output);
        assert_eq!(players[0].ign, "Notch");
        assert_eq!(players[0].uuid, "550e8400-e29b-41d4-a716-446655440000");
    }
}
