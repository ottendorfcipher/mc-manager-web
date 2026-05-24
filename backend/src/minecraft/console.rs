/// All Minecraft console commands go through this module.
/// This keeps the FIFO protocol in one place (Single Responsibility).
use crate::{config::Config, error::Result, gcloud::ssh};

pub async fn send(cfg: &Config, command: &str) -> Result<bool> {
    ssh::fifo_command(cfg, command).await
}

/// Send multiple console commands in sequence. Returns `true` if all succeeded.
/// Individual command failures are logged but do not abort the batch — useful
/// for best-effort fanout (e.g. teleporting many players at once).
pub async fn send_batch(cfg: &Config, commands: &[&str]) -> Result<bool> {
    let mut all_ok = true;
    for cmd in commands {
        match ssh::fifo_command(cfg, cmd).await {
            Ok(true)  => {}
            Ok(false) => all_ok = false,
            Err(e)    => {
                tracing::warn!("console: batch command failed: {cmd} → {e}");
                all_ok = false;
            }
        }
    }
    Ok(all_ok)
}

pub async fn set_gamerule(cfg: &Config, rule: &str, value: &str) -> Result<bool> {
    send(cfg, &format!("gamerule {rule} {value}")).await
}

pub async fn set_time(cfg: &Config, ticks: u32) -> Result<bool> {
    send(cfg, &format!("time set {ticks}")).await
}

pub async fn set_weather(cfg: &Config, kind: WeatherKind) -> Result<bool> {
    let cmd = match kind {
        WeatherKind::Clear => "weather clear 9999999".to_string(),
        WeatherKind::Rain => "weather rain".to_string(),
        WeatherKind::Thunder => "weather thunder".to_string(),
    };
    send(cfg, &cmd).await
}

pub async fn set_gamemode(cfg: &Config, player: &str, mode: &str) -> Result<bool> {
    send(cfg, &format!("gamemode {mode} {player}")).await
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WeatherKind {
    Clear,
    Rain,
    Thunder,
}
