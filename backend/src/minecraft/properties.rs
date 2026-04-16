use std::collections::HashMap;
use crate::{config::Config, error::Result, gcloud::ssh};

const REMOTE_PROPS: &str = "/opt/minecraft/server.properties";
const REMOTE_TMP:   &str = "/tmp/server_props_update.properties";

/// Fetch server.properties as a key-value map.
pub async fn get_all(cfg: &Config) -> Result<HashMap<String, String>> {
    let (out, _) = ssh::run(cfg, &format!("cat {REMOTE_PROPS} 2>/dev/null")).await?;
    Ok(parse_properties(&out))
}

/// Apply a map of updates to server.properties and restart the service.
/// Only keys present in `updates` are modified; all others are preserved.
pub async fn apply_updates(
    cfg: &Config,
    updates: &HashMap<String, String>,
) -> Result<()> {
    // Read existing content
    let (existing, _) = ssh::run(cfg, &format!("cat {REMOTE_PROPS}")).await?;

    let new_content = merge_properties(&existing, updates);

    // Write to tmp, then move into place
    let write_cmd = format!(
        "printf '%s' {content} > {tmp} && \
         sudo cp {tmp} {dest} && \
         sudo chown minecraft:minecraft {dest} && \
         sudo systemctl restart minecraft && echo DONE",
        content = shell_escape(&new_content),
        tmp  = REMOTE_TMP,
        dest = REMOTE_PROPS,
    );

    let (out, _) = ssh::run_with_timeout(
        cfg,
        &write_cmd,
        std::time::Duration::from_secs(60),
    )
    .await?;

    if !out.contains("DONE") {
        return Err(crate::error::AppError::ExternalCommand(
            "server.properties update did not complete".into(),
        ));
    }
    Ok(())
}

fn parse_properties(text: &str) -> HashMap<String, String> {
    text.lines()
        .filter(|l| !l.trim_start().starts_with('#') && l.contains('='))
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| (k.trim().to_owned(), v.trim().to_owned()))
        .collect()
}

fn merge_properties(original: &str, updates: &HashMap<String, String>) -> String {
    let mut updated_keys = std::collections::HashSet::new();
    let mut lines: Vec<String> = original
        .lines()
        .map(|line| {
            if line.trim_start().starts_with('#') || !line.contains('=') {
                return line.to_owned();
            }
            if let Some((key, _)) = line.split_once('=') {
                let key = key.trim();
                if let Some(val) = updates.get(key) {
                    updated_keys.insert(key.to_owned());
                    return format!("{key}={val}");
                }
            }
            line.to_owned()
        })
        .collect();

    // Append any keys from updates that didn't already exist
    for (k, v) in updates {
        if !updated_keys.contains(k.as_str()) {
            lines.push(format!("{k}={v}"));
        }
    }
    lines.join("\n") + "\n"
}

fn shell_escape(s: &str) -> String {
    // Wrap in $'...' to allow arbitrary content through printf
    format!("$'{}'", s.replace('\'', r"'\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_updates_existing_key() {
        let original = "online-mode=true\ndifficulty=easy\n";
        let mut updates = HashMap::new();
        updates.insert("difficulty".into(), "hard".into());
        let merged = merge_properties(original, &updates);
        assert!(merged.contains("difficulty=hard"));
        assert!(merged.contains("online-mode=true"));
    }

    #[test]
    fn merge_adds_new_key() {
        let original = "online-mode=true\n";
        let mut updates = HashMap::new();
        updates.insert("max-players".into(), "30".into());
        let merged = merge_properties(original, &updates);
        assert!(merged.contains("max-players=30"));
    }
}
