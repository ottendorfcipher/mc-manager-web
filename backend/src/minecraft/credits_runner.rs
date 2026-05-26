//! Fire-and-forget per-player scrolling credits playback.
//!
//! Each playback is a self-contained `tokio::spawn` that:
//!   1. Applies darkness + slowness effects (if freeze_player).
//!   2. Clears chat with blank tellraw lines.
//!   3. Iterates through credit lines at the configured scroll speed:
//!      - heading → `title` command (large centered text)
//!      - line    → `tellraw` (chat scroll)
//!      - blank   → empty tellraw spacer
//!   4. Cleans up effects when done.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;
use tracing::warn;

use crate::{
    config::Config,
    db::credits::{CreditLine, ScrollingCredits},
    gcloud::ssh,
    minecraft::console,
};

/// Set of `(zone_id, player_ign)` pairs with credits currently playing.
/// Prevents duplicate playback for the same player in the same zone.
pub type ActiveCreditsSet = Arc<Mutex<HashSet<(i64, String)>>>;

/// Spawn a self-contained credits playback for one player.
/// The task removes itself from `active` when it finishes.
pub fn spawn_credits_playback(
    cfg: Config,
    zone_id: i64,
    player_ign: String,
    credits: ScrollingCredits,
    active: ActiveCreditsSet,
) {
    tokio::spawn(async move {
        let key = (zone_id, player_ign.clone());

        // Mark active (double-check not already running).
        {
            let mut set = active.lock().await;
            if set.contains(&key) {
                return;
            }
            set.insert(key.clone());
        }

        if let Err(e) = run_playback(&cfg, &player_ign, &credits).await {
            warn!("credits[{}]: playback error for {player_ign}: {e:?}", credits.name);
        }

        // Always clean up the active-set entry.
        active.lock().await.remove(&key);
    });
}

async fn run_playback(
    cfg: &Config,
    ign: &str,
    credits: &ScrollingCredits,
) -> anyhow::Result<()> {
    let sel = format!("@p[name={}]", ign);
    let interval = Duration::from_millis(credits.scroll_speed_ms.max(200) as u64);

    let lines: Vec<CreditLine> = serde_json::from_str(&credits.lines_json)
        .unwrap_or_default();
    if lines.is_empty() {
        return Ok(());
    }

    tracing::info!("credits[{}]: starting for {ign} ({} lines)", credits.name, lines.len());

    // ── 1. Setup: clear chat + apply effects ─────────────────────────────
    let mut setup: Vec<String> = Vec::new();

    // Push old chat off screen with blank lines.
    for _ in 0..20 {
        setup.push(format!("tellraw {sel} \"\""));
    }

    if credits.freeze_player == 1 {
        setup.push(format!("effect give {sel} minecraft:darkness 9999 0 true"));
        setup.push(format!("effect give {sel} minecraft:slowness 9999 255 true"));
    }

    // Set title timing: 0.5s fade-in, 3s stay, 0.5s fade-out.
    setup.push(format!("title {sel} times 10 60 10"));

    let _ = ssh::fifo_batch(cfg, &setup).await;

    // Brief pause to let effects settle before first line.
    tokio::time::sleep(Duration::from_millis(500)).await;

    // ── 2. Playback: iterate through lines ───────────────────────────────
    // Batch consecutive non-heading lines to reduce SSH calls.
    let mut batch: Vec<String> = Vec::new();

    for line in &lines {
        match line.line_type.as_str() {
            "heading" => {
                // Flush any pending batch first.
                if !batch.is_empty() {
                    let _ = ssh::fifo_batch(cfg, &batch).await;
                    batch.clear();
                }

                let json = format_text_json(
                    line.text.as_deref().unwrap_or(""),
                    &line.color,
                    line.bold,
                    line.italic,
                );
                let cmds = vec![
                    format!("title {sel} times 10 60 10"),
                    format!("title {sel} title {json}"),
                ];
                let _ = ssh::fifo_batch(cfg, &cmds).await;

                // Headings pause for 2× interval.
                tokio::time::sleep(interval * 2).await;
            }
            "line" => {
                let json = format_text_json(
                    line.text.as_deref().unwrap_or(""),
                    &line.color,
                    line.bold,
                    line.italic,
                );
                batch.push(format!("tellraw {sel} {json}"));

                // Flush batch every 3 lines or send immediately.
                if batch.len() >= 3 {
                    let _ = ssh::fifo_batch(cfg, &batch).await;
                    batch.clear();
                }
                tokio::time::sleep(interval).await;
            }
            "blank" => {
                batch.push(format!("tellraw {sel} \"\""));
                if batch.len() >= 3 {
                    let _ = ssh::fifo_batch(cfg, &batch).await;
                    batch.clear();
                }
                tokio::time::sleep(interval).await;
            }
            _ => {}
        }
    }

    // Flush remaining batch.
    if !batch.is_empty() {
        let _ = ssh::fifo_batch(cfg, &batch).await;
    }

    // Brief pause at the end before cleanup.
    tokio::time::sleep(Duration::from_secs(2)).await;

    // ── 3. Cleanup: remove effects ───────────────────────────────────────
    if credits.freeze_player == 1 {
        let cleanup = vec![
            format!("effect clear {sel} minecraft:darkness"),
            format!("effect clear {sel} minecraft:slowness"),
            format!("title {sel} clear"),
        ];
        let _ = ssh::fifo_batch(cfg, &cleanup).await;
    } else {
        let _ = console::send(cfg, &format!("title {sel} clear")).await;
    }

    tracing::info!("credits[{}]: finished for {ign}", credits.name);
    Ok(())
}

/// Build a Minecraft JSON text component.
fn format_text_json(text: &str, color: &str, bold: bool, italic: bool) -> String {
    serde_json::json!({
        "text": text,
        "color": color,
        "bold": bold,
        "italic": italic,
    })
    .to_string()
}
