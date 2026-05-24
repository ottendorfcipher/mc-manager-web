//! Thin wrappers around Minecraft console commands for countdown display.

use crate::{config::Config, error::Result, minecraft::console};

// ── Actionbar / Title ──────────────────────────────────────────────────────────

pub async fn show_actionbar(cfg: &Config, target: &str, json_text: &str) -> Result<bool> {
    console::send(cfg, &format!("title {target} actionbar {json_text}")).await
}

pub async fn show_title(cfg: &Config, target: &str, json_text: &str) -> Result<bool> {
    console::send(cfg, &format!("title {target} title {json_text}")).await
}

pub async fn show_subtitle(cfg: &Config, target: &str, json_text: &str) -> Result<bool> {
    console::send(cfg, &format!("title {target} subtitle {json_text}")).await
}

pub async fn set_title_times(
    cfg: &Config, target: &str, fade_in: u32, stay: u32, fade_out: u32,
) -> Result<bool> {
    console::send(cfg, &format!("title {target} times {fade_in} {stay} {fade_out}")).await
}

pub async fn clear_title(cfg: &Config, target: &str) -> Result<bool> {
    console::send(cfg, &format!("title {target} clear")).await
}

// ── Bossbar ────────────────────────────────────────────────────────────────────

pub async fn bossbar_add(cfg: &Config, bar_id: &str, json_name: &str) -> Result<bool> {
    console::send(cfg, &format!("bossbar add {bar_id} {json_name}")).await
}

pub async fn bossbar_set_players(cfg: &Config, bar_id: &str, target: &str) -> Result<bool> {
    console::send(cfg, &format!("bossbar set {bar_id} players {target}")).await
}

pub async fn bossbar_set_value(cfg: &Config, bar_id: &str, value: u32) -> Result<bool> {
    console::send(cfg, &format!("bossbar set {bar_id} value {value}")).await
}

pub async fn bossbar_set_max(cfg: &Config, bar_id: &str, max: u32) -> Result<bool> {
    console::send(cfg, &format!("bossbar set {bar_id} max {max}")).await
}

pub async fn bossbar_set_color(cfg: &Config, bar_id: &str, color: &str) -> Result<bool> {
    console::send(cfg, &format!("bossbar set {bar_id} color {color}")).await
}

pub async fn bossbar_set_name(cfg: &Config, bar_id: &str, json_name: &str) -> Result<bool> {
    console::send(cfg, &format!("bossbar set {bar_id} name {json_name}")).await
}

pub async fn bossbar_set_visible(cfg: &Config, bar_id: &str, visible: bool) -> Result<bool> {
    console::send(cfg, &format!("bossbar set {bar_id} visible {visible}")).await
}

pub async fn bossbar_remove(cfg: &Config, bar_id: &str) -> Result<bool> {
    console::send(cfg, &format!("bossbar remove {bar_id}")).await
}

// ── Text formatting ────────────────────────────────────────────────────────────

/// Build a Minecraft JSON text component for the countdown display.
pub fn format_countdown_text(title: &str, remaining_secs: i64, color: &str) -> String {
    let mins = remaining_secs / 60;
    let secs = remaining_secs % 60;
    serde_json::json!({
        "text": format!("{title}  {mins}:{secs:02}"),
        "color": color,
        "bold": remaining_secs <= 10
    })
    .to_string()
}

/// Build a dramatic title-text component for final seconds.
pub fn format_final_title(remaining_secs: i64, color: &str) -> String {
    serde_json::json!({
        "text": format!("{remaining_secs}"),
        "color": if remaining_secs <= 3 { "red" } else { color },
        "bold": true
    })
    .to_string()
}
