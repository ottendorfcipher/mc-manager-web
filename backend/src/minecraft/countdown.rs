//! Thin wrappers around Minecraft console commands for countdown display.

use crate::{config::Config, error::Result, minecraft::console};

// ── Target expansion ───────────────────────────────────────────────────────────

/// Expand a stored `target` string into one or more MC selector strings that
/// can be used directly in `/title <selector> …` / `/playsound <selector> …`.
///
/// Accepted formats:
///   • `@a`                 → vec!["@a"]
///   • `@a[…]`              → vec!["@a[…]"]   (raw selector, returned as-is)
///   • `Alice`              → vec!["Alice"]
///   • `Alice,Bob,Charlie`  → vec!["Alice", "Bob", "Charlie"]
///
/// Blank entries are dropped.
pub fn expand_target(target: &str) -> Vec<String> {
    let t = target.trim();
    if t.is_empty() { return vec!["@a".into()]; }
    if t.starts_with('@') { return vec![t.into()]; }
    t.split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

// ── Color mapping for bossbars (named-color only) ─────────────────────────────

/// Map a `color` string (named MC color OR `#RRGGBB`) to the nearest bossbar-
/// compatible named color.  Bossbar only supports: blue, green, pink, purple,
/// red, white, yellow.
pub fn nearest_bossbar_color(color: &str) -> &'static str {
    // Named-color fast path
    match color.to_lowercase().trim_start_matches('#') {
        "blue" | "aqua" | "dark_blue" | "dark_aqua" => return "blue",
        "green" | "dark_green"                       => return "green",
        "pink" | "light_purple"                      => return "pink",
        "purple" | "dark_purple"                     => return "purple",
        "red" | "dark_red"                           => return "red",
        "white" | "gray" | "dark_gray"               => return "white",
        "yellow" | "gold"                            => return "yellow",
        _ => {}
    }

    // Hex (RRGGBB) → nearest in palette
    if let Some(rgb) = parse_hex_rgb(color) {
        const PALETTE: &[(&str, (u8, u8, u8))] = &[
            ("blue",   (0x55, 0x55, 0xFF)),
            ("green",  (0x55, 0xFF, 0x55)),
            ("pink",   (0xFF, 0x55, 0xFF)),
            ("purple", (0xAA, 0x00, 0xAA)),
            ("red",    (0xFF, 0x55, 0x55)),
            ("white",  (0xFF, 0xFF, 0xFF)),
            ("yellow", (0xFF, 0xFF, 0x55)),
        ];
        return PALETTE
            .iter()
            .min_by_key(|(_, p)| color_distance_sq(rgb, *p))
            .map(|(name, _)| *name)
            .unwrap_or("yellow");
    }

    "yellow"
}

/// Parse `#RRGGBB` or `RRGGBB` into (r, g, b).  Returns None on malformed input.
fn parse_hex_rgb(s: &str) -> Option<(u8, u8, u8)> {
    let hex = s.trim_start_matches('#');
    if hex.len() != 6 { return None; }
    let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
    let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
    let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
    Some((r, g, b))
}

fn color_distance_sq(a: (u8, u8, u8), b: (u8, u8, u8)) -> u32 {
    let dr = a.0 as i32 - b.0 as i32;
    let dg = a.1 as i32 - b.1 as i32;
    let db = a.2 as i32 - b.2 as i32;
    (dr * dr + dg * dg + db * db) as u32
}

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
/// `color` may be a Minecraft named colour (e.g. "yellow") or a `#RRGGBB`
/// hex string (supported in 1.16+ text components).
pub fn format_countdown_text(title: &str, remaining_secs: i64, color: &str) -> String {
    let mins = remaining_secs / 60;
    let secs = remaining_secs % 60;
    serde_json::json!({
        "text": format!("{title}  {mins}:{secs:02}"),
        "color": normalize_text_color(color),
        "bold": remaining_secs <= 10
    })
    .to_string()
}

/// Build a dramatic title-text component for final seconds.
pub fn format_final_title(remaining_secs: i64, color: &str) -> String {
    let c = if remaining_secs <= 3 { "red".to_string() } else { normalize_text_color(color) };
    serde_json::json!({
        "text": format!("{remaining_secs}"),
        "color": c,
        "bold": true
    })
    .to_string()
}

/// Return a value safe to drop into a JSON text component's `color` field.
/// Accepts `#RRGGBB`, `RRGGBB`, or a named colour; returns the same kind of
/// string MC expects (named colour passed through, hex prefixed with `#`).
fn normalize_text_color(color: &str) -> String {
    let trimmed = color.trim();
    if trimmed.is_empty() { return "yellow".into(); }
    if let Some((_r, _g, _b)) = parse_hex_rgb(trimmed) {
        if trimmed.starts_with('#') { trimmed.to_string() } else { format!("#{trimmed}") }
    } else {
        trimmed.to_string()
    }
}
