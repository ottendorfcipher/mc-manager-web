//! Background task that drives active countdowns — ticks every second,
//! sends Minecraft display commands, and broadcasts state to SSE clients.
//!
//! Architecture mirrors `minecraft::music` — ephemeral in-memory state +
//! background Tokio task + SSE broadcast helper.

use std::sync::Arc;
use std::time::{Duration, Instant};

use sqlx::SqlitePool;
use tokio::sync::{broadcast, Mutex};
use tracing::warn;

use crate::{
    config::Config,
    db::countdowns::{self, CountdownStatePayload, ActiveCountdownPayload},
    minecraft::countdown as mc,
};

// ── In-memory active state ─────────────────────────────────────────────────────

/// Ephemeral state for the running countdown, held in `AppState::countdown_active`.
#[derive(Debug)]
pub struct ActiveCountdown {
    pub id:             i64,
    pub title:          String,
    pub duration_secs:  i64,
    pub target:         String,
    pub display_mode:   String,
    pub color:          String,
    pub sound_id:       Option<String>,
    pub created_by:     String,
    /// Accumulated seconds elapsed before the most recent resume.
    pub elapsed_before_resume: i64,
    /// Monotonic instant of the most recent resume/start.
    pub resumed_at:     Instant,
    pub paused:         bool,
}

impl ActiveCountdown {
    pub fn remaining_secs(&self) -> i64 {
        if self.paused {
            self.duration_secs - self.elapsed_before_resume
        } else {
            let live_elapsed = self.elapsed_before_resume
                + self.resumed_at.elapsed().as_secs() as i64;
            (self.duration_secs - live_elapsed).max(0)
        }
    }

    pub fn total_elapsed(&self) -> i64 {
        if self.paused {
            self.elapsed_before_resume
        } else {
            self.elapsed_before_resume + self.resumed_at.elapsed().as_secs() as i64
        }
    }

    pub fn has_mode(&self, flag: &str) -> bool {
        self.display_mode.split(',').any(|m| m.trim() == flag)
    }
}

// ── Broadcast helper ───────────────────────────────────────────────────────────

/// Build the current `CountdownStatePayload` from DB + in-memory state,
/// then broadcast it to all SSE subscribers.
pub async fn broadcast_state(
    pool:    &SqlitePool,
    active:  &Mutex<Option<ActiveCountdown>>,
    tx:      &broadcast::Sender<Arc<CountdownStatePayload>>,
) {
    let recent = match countdowns::list_recent(pool, 20).await {
        Ok(r)  => r,
        Err(e) => { warn!("countdown: broadcast list error: {e}"); return; }
    };

    let active_payload = {
        let guard = active.lock().await;
        guard.as_ref().map(|a| ActiveCountdownPayload {
            id:             a.id,
            title:          a.title.clone(),
            duration_secs:  a.duration_secs,
            remaining_secs: a.remaining_secs(),
            target:         a.target.clone(),
            display_mode:   a.display_mode.clone(),
            color:          a.color.clone(),
            sound_id:       a.sound_id.clone(),
            status:         if a.paused { "paused".into() } else { "running".into() },
            created_by:     a.created_by.clone(),
        })
    };

    let _ = tx.send(Arc::new(CountdownStatePayload {
        active: active_payload,
        recent,
    }));
}

// ── Background tick task ───────────────────────────────────────────────────────

const BOSSBAR_ID: &str = "rsc:countdown";

pub fn spawn_countdown_task(
    cfg:    Config,
    pool:   SqlitePool,
    active: Arc<Mutex<Option<ActiveCountdown>>>,
    tx:     broadcast::Sender<Arc<CountdownStatePayload>>,
) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        // Skip the immediate first tick so we don't race with startup.
        interval.tick().await;

        loop {
            interval.tick().await;

            let guard = active.lock().await;
            let Some(ref a) = *guard else { continue };
            if a.paused { continue; }

            let remaining = a.remaining_secs();
            let id = a.id;
            let title = a.title.clone();
            let target = a.target.clone();
            let _display_mode = a.display_mode.clone();
            let color = a.color.clone();
            let sound_id = a.sound_id.clone();
            let duration = a.duration_secs;
            let total_elapsed = a.total_elapsed();
            let has_actionbar = a.has_mode("actionbar");
            let has_bossbar = a.has_mode("bossbar");
            let has_title_final = a.has_mode("title_final");
            drop(guard);

            let selectors = mc::expand_target(&target);

            if remaining <= 0 {
                // ── Finished ───────────────────────────────────────────────
                let _ = countdowns::update_status(&pool, id, "finished", total_elapsed).await;

                // Clear MC displays
                if has_bossbar {
                    let _ = mc::bossbar_remove(&cfg, BOSSBAR_ID).await;
                }
                for sel in &selectors {
                    let _ = mc::clear_title(&cfg, sel).await;
                    let _ = mc::set_title_times(&cfg, sel, 0, 40, 20).await;
                    let go_text = serde_json::json!({"text":"GO!","color":"green","bold":true}).to_string();
                    let _ = mc::show_title(&cfg, sel, &go_text).await;
                }

                // If sound paired, trigger music playback
                if let Some(ref sid) = sound_id {
                    let _ = crate::minecraft::music::play_all(&cfg, sid).await;
                }

                // Clear in-memory state
                {
                    let mut guard = active.lock().await;
                    *guard = None;
                }

                broadcast_state(&pool, &active, &tx).await;
                continue;
            }

            // ── Send MC display commands ───────────────────────────────────
            if has_actionbar {
                let text = mc::format_countdown_text(&title, remaining, &color);
                for sel in &selectors {
                    let _ = mc::show_actionbar(&cfg, sel, &text).await;
                }
            }

            if has_bossbar {
                let value = (remaining as u32).min(duration as u32);
                let name = mc::format_countdown_text(&title, remaining, &color);
                let _ = mc::bossbar_set_name(&cfg, BOSSBAR_ID, &name).await;
                let _ = mc::bossbar_set_value(&cfg, BOSSBAR_ID, value).await;
            }

            if has_title_final && remaining <= 10 {
                let title_text = mc::format_final_title(remaining, &color);
                for sel in &selectors {
                    let _ = mc::set_title_times(&cfg, sel, 0, 25, 5).await;
                    let _ = mc::show_title(&cfg, sel, &title_text).await;
                }
            }

            broadcast_state(&pool, &active, &tx).await;
        }
    });
}
