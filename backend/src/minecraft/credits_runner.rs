//! Fire-and-forget per-player scrolling credits playback.
//!
//! Renders as cohesive, CENTERED, upward-scrolling credits (like an end-of-movie
//! roll) rather than a title-flash + chat-corner hybrid. Minecraft titles support
//! multi-line text components (`\n`), so each frame is a single `title` made of a
//! fixed-height window of lines; advancing the window one line per step makes the
//! whole block scroll upward in the center of the screen.
//!
//! Each playback is a self-contained `tokio::spawn` that:
//!   1. Applies darkness (dims the world) + slowness 255 (freeze), if enabled.
//!   2. Sets a persistent title timing (fade 0 / long stay / fade 0) so frames
//!      swap instantly with no flicker.
//!   3. Slides a centered N-line window across the (blank-padded) credit lines.
//!   4. Clears the title and effects when done.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;
use tracing::warn;

use crate::{
    config::Config,
    db::credits::{CreditLine, ScrollingCredits},
    gcloud::ssh,
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

/// Number of credit lines visible at once in the centered window.
const WINDOW: usize = 5;

async fn run_playback(
    cfg: &Config,
    ign: &str,
    credits: &ScrollingCredits,
) -> anyhow::Result<()> {
    // `@a[..,limit=1]` targets the named player reliably from the console in any
    // dimension (`@p` sorts by distance from the executor at world origin).
    let sel  = format!("@a[name={ign},limit=1]");
    let step = Duration::from_millis(credits.scroll_speed_ms.clamp(300, 5000) as u64);

    let lines: Vec<CreditLine> =
        serde_json::from_str(&credits.lines_json).unwrap_or_default();
    if lines.is_empty() {
        return Ok(());
    }

    // Render every credit line, padded with WINDOW blank lines above and below so
    // the first line scrolls in from the bottom and the last scrolls fully off
    // the top. Every window slice therefore has exactly WINDOW entries, keeping
    // the block a constant height (so it stays centered while content moves up).
    let mut display: Vec<RenderLine> = Vec::with_capacity(lines.len() + WINDOW * 2);
    for _ in 0..WINDOW { display.push(RenderLine::blank()); }
    for l in &lines { display.push(RenderLine::from(l)); }
    for _ in 0..WINDOW { display.push(RenderLine::blank()); }

    let steps = display.len() - WINDOW + 1;
    // Effects must outlast the whole roll (+buffer) in case cleanup is missed.
    let total_secs = (steps as u64 * step.as_millis() as u64) / 1000 + 5;

    tracing::info!(
        "credits[{}]: starting for {ign} ({} lines, {steps} frames, ~{total_secs}s)",
        credits.name, lines.len(),
    );

    // ── Setup: freeze + darken, persistent title timing ──────────────────────
    let mut setup: Vec<String> = Vec::new();
    if credits.freeze_player == 1 {
        // darkness dims the world so the centered text pops; slowness 255 freezes.
        setup.push(format!("effect give {sel} minecraft:darkness {total_secs} 0 true"));
        setup.push(format!("effect give {sel} minecraft:slowness {total_secs} 255 true"));
    }
    // fadeIn 0 / fadeOut 0 with a long stay → re-issuing `title ... title` each
    // frame swaps the text instantly with no fade flicker.
    setup.push(format!("title {sel} times 0 {} 0", total_secs * 20 + 40));
    let _ = ssh::fifo_batch(cfg, &setup).await;

    tokio::time::sleep(Duration::from_millis(400)).await;

    // ── Scroll: slide the centered window across the padded display ───────────
    for i in 0..steps {
        let component = build_window_component(&display[i..i + WINDOW]);
        let _ = ssh::fifo_command(cfg, &format!("title {sel} title {component}")).await;
        tokio::time::sleep(step).await;
    }

    tokio::time::sleep(Duration::from_secs(1)).await;

    // ── Cleanup ──────────────────────────────────────────────────────────────
    let mut cleanup = vec![format!("title {sel} clear")];
    if credits.freeze_player == 1 {
        cleanup.push(format!("effect clear {sel} minecraft:darkness"));
        cleanup.push(format!("effect clear {sel} minecraft:slowness"));
    }
    let _ = ssh::fifo_batch(cfg, &cleanup).await;

    tracing::info!("credits[{}]: finished for {ign}", credits.name);
    Ok(())
}

/// A single rendered line for the centered title block.
struct RenderLine {
    text:   String,
    color:  String,
    bold:   bool,
    italic: bool,
}

impl RenderLine {
    fn blank() -> Self {
        Self { text: String::new(), color: "white".into(), bold: false, italic: false }
    }
}

impl From<&CreditLine> for RenderLine {
    fn from(l: &CreditLine) -> Self {
        match l.line_type.as_str() {
            "blank" => RenderLine::blank(),
            _ => RenderLine {
                text:   l.text.clone().unwrap_or_default(),
                color:  if l.color.trim().is_empty() { "white".into() } else { l.color.clone() },
                bold:   l.bold,
                italic: l.italic,
            },
        }
    }
}

/// Build one centered, multi-line title component from a window of lines.
/// Lines are joined with `\n` (newline after every line except the last) so the
/// block stays a fixed height and scrolls upward as a unit between frames.
fn build_window_component(window: &[RenderLine]) -> String {
    let extra: Vec<serde_json::Value> = window
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let mut text = r.text.clone();
            if i + 1 < window.len() {
                text.push('\n');
            }
            serde_json::json!({
                "text":   text,
                "color":  r.color,
                "bold":   r.bold,
                "italic": r.italic,
            })
        })
        .collect();
    serde_json::json!({ "text": "", "extra": extra }).to_string()
}
