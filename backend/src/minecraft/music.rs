//! Music-queue logic for the redstoneCipher music player.
//!
//! Responsibilities:
//!   • Static catalog of all vanilla 1.21 music-disc sounds with known durations.
//!   • Thin wrappers around /playsound and /stopsound console commands.
//!   • `CurrentTrack` — ephemeral in-memory state for the now-playing track.
//!   • `start_next`  — shared helper called by the skip handler and background task.
//!   • `broadcast_state` — build + publish a MusicStatePayload to the SSE channel.
//!   • `spawn_player_task` — background Tokio task that auto-advances the queue.

use std::sync::Arc;
use std::time::{Duration, Instant};

use sqlx::SqlitePool;
use tokio::sync::broadcast;
use tracing::warn;

use crate::{
    config::Config,
    db::music_queue::{self, MusicStatePayload, NowPlayingPayload},
    error::Result,
    minecraft::console,
};

// ── Sound catalog ──────────────────────────────────────────────────────────────

/// One entry in the static vanilla sound catalog.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SoundEntry {
    /// Minecraft namespaced sound event — passed verbatim to /playsound.
    pub id:            &'static str,
    pub display_name:  &'static str,
    pub artist:        &'static str,
    /// Approximate track duration in seconds (sourced from Minecraft Wiki).
    pub duration_secs: u32,
}

/// All vanilla music-disc sounds available in Minecraft 1.21.x.
/// Durations are approximate; the background task uses them to schedule
/// auto-advance.
pub static CATALOG: &[SoundEntry] = &[
    SoundEntry { id: "minecraft:music_disc.13",                display_name: "13",                  artist: "C418",          duration_secs: 178 },
    SoundEntry { id: "minecraft:music_disc.cat",               display_name: "Cat",                 artist: "C418",          duration_secs: 185 },
    SoundEntry { id: "minecraft:music_disc.blocks",            display_name: "Blocks",              artist: "C418",          duration_secs: 345 },
    SoundEntry { id: "minecraft:music_disc.chirp",             display_name: "Chirp",               artist: "C418",          duration_secs: 185 },
    SoundEntry { id: "minecraft:music_disc.far",               display_name: "Far",                 artist: "C418",          duration_secs: 174 },
    SoundEntry { id: "minecraft:music_disc.mall",              display_name: "Mall",                artist: "C418",          duration_secs: 197 },
    SoundEntry { id: "minecraft:music_disc.mellohi",           display_name: "Mellohi",             artist: "C418",          duration_secs: 96  },
    SoundEntry { id: "minecraft:music_disc.stal",              display_name: "Stal",                artist: "C418",          duration_secs: 150 },
    SoundEntry { id: "minecraft:music_disc.strad",             display_name: "Strad",               artist: "C418",          duration_secs: 188 },
    SoundEntry { id: "minecraft:music_disc.ward",              display_name: "Ward",                artist: "C418",          duration_secs: 251 },
    SoundEntry { id: "minecraft:music_disc.11",                display_name: "11",                  artist: "C418",          duration_secs: 71  },
    SoundEntry { id: "minecraft:music_disc.wait",              display_name: "Wait",                artist: "C418",          duration_secs: 238 },
    SoundEntry { id: "minecraft:music_disc.otherside",         display_name: "Otherside",           artist: "Lena Raine",    duration_secs: 195 },
    SoundEntry { id: "minecraft:music_disc.5",                 display_name: "5",                   artist: "Samuel Åberg",  duration_secs: 178 },
    SoundEntry { id: "minecraft:music_disc.pigstep",           display_name: "Pigstep",             artist: "Lena Raine",    duration_secs: 148 },
    SoundEntry { id: "minecraft:music_disc.relic",             display_name: "Relic",               artist: "Aaron Cherof",  duration_secs: 219 },
    SoundEntry { id: "minecraft:music_disc.precipice",         display_name: "Precipice",           artist: "Aaron Cherof",  duration_secs: 299 },
    SoundEntry { id: "minecraft:music_disc.creator",           display_name: "Creator",             artist: "Lena Raine",    duration_secs: 174 },
    SoundEntry { id: "minecraft:music_disc.creator_music_box", display_name: "Creator (Music Box)", artist: "Lena Raine",    duration_secs: 73  },
];

/// Look up a catalog entry by its sound ID.
pub fn lookup(sound_id: &str) -> Option<&'static SoundEntry> {
    CATALOG.iter().find(|e| e.id == sound_id)
}

// ── In-memory now-playing state ────────────────────────────────────────────────

/// Ephemeral state held in `AppState::music_current`.
/// Not serialisable — use `NowPlayingPayload` (in db::music_queue) for the wire
/// format, computed from this struct + `started_at.elapsed()`.
#[derive(Debug)]
pub struct CurrentTrack {
    /// Row id of the DB queue entry that was popped to produce this track.
    /// Set to `0` for tracks started immediately without going through the DB queue.
    pub queue_id:      i64,
    pub sound_id:      String,
    pub display_name:  String,
    pub artist:        String,
    pub requested_by:  String,
    /// Monotonic start time — used by the background task to detect track end.
    pub started_at:    Instant,
    pub duration_secs: u32,
}

// ── Console helpers ────────────────────────────────────────────────────────────

/// Send `/playsound <sound> music @a ~ ~ ~ 1000000 1` so the sound is audible
/// everywhere on the map regardless of player position.
pub async fn play_all(cfg: &Config, sound_id: &str) -> Result<bool> {
    console::send(cfg, &format!("playsound {sound_id} music @a ~ ~ ~ 1000000 1")).await
}

/// Send `/stopsound @a music` to silence all music-channel sounds for everyone.
pub async fn stop_all(cfg: &Config) -> Result<bool> {
    console::send(cfg, "stopsound @a music").await
}

// ── Shared queue-advance logic ─────────────────────────────────────────────────

/// Pop the front entry from the DB queue and start playing it.
/// Updates `current` and broadcasts the new state.
///
/// Called by:
///   • The background auto-advance task (when the current track ends).
///   • The `/api/music/skip` handler.
pub async fn start_next(
    cfg:     &Config,
    pool:    &SqlitePool,
    current: &tokio::sync::Mutex<Option<CurrentTrack>>,
    tx:      &broadcast::Sender<Arc<MusicStatePayload>>,
) {
    match music_queue::pop_front(pool).await {
        Ok(Some(next)) => {
            let cat   = lookup(&next.sound_id);
            let dur   = cat.map(|e| e.duration_secs).unwrap_or(180);
            let artist = cat.map(|e| e.artist.to_string()).unwrap_or_default();

            // Hold the mutex across the SSH call to prevent a concurrent
            // enqueue from seeing an idle state and firing a duplicate playsound.
            let mut guard = current.lock().await;
            let _ = play_all(cfg, &next.sound_id).await;
            *guard = Some(CurrentTrack {
                queue_id:      next.id,
                sound_id:      next.sound_id,
                display_name:  next.display_name,
                artist,
                requested_by:  next.requested_by,
                started_at:    Instant::now(),
                duration_secs: dur,
            });
            drop(guard);
        }
        Ok(None) => {
            // Queue exhausted.
            let mut guard = current.lock().await;
            *guard = None;
            drop(guard);
        }
        Err(e) => {
            warn!("music: pop_front failed: {e}");
            return;
        }
    }

    broadcast_state(pool, current, tx).await;
}

// ── SSE broadcast helper ───────────────────────────────────────────────────────

/// Build the current `MusicStatePayload` from DB + in-memory state, then
/// broadcast it to all SSE subscribers.  Failures are logged and ignored.
pub async fn broadcast_state(
    pool:    &SqlitePool,
    current: &tokio::sync::Mutex<Option<CurrentTrack>>,
    tx:      &broadcast::Sender<Arc<MusicStatePayload>>,
) {
    let queue = match music_queue::list(pool).await {
        Ok(q)  => q,
        Err(e) => { warn!("music: broadcast_state list error: {e}"); return; }
    };

    let now_playing = {
        let guard = current.lock().await;
        guard.as_ref().map(|t| NowPlayingPayload {
            queue_id:      t.queue_id,
            sound_id:      t.sound_id.clone(),
            display_name:  t.display_name.clone(),
            artist:        t.artist.clone(),
            requested_by:  t.requested_by.clone(),
            elapsed_secs:  t.started_at.elapsed().as_secs(),
            duration_secs: t.duration_secs,
        })
    };

    let _ = tx.send(Arc::new(MusicStatePayload { now_playing, queue }));
}

// ── Background auto-advance task ───────────────────────────────────────────────

/// Spawn the music-player background task.
///
/// Every `TICK` seconds the task checks whether the current track has
/// finished playing (elapsed ≥ duration) and, if so, advances to the next
/// entry in the DB queue.  The coarse tick is intentional: Minecraft sound
/// durations are approximate and the /playsound command gives no completion
/// callback.
pub fn spawn_player_task(
    cfg:     Config,
    pool:    SqlitePool,
    current: Arc<tokio::sync::Mutex<Option<CurrentTrack>>>,
    tx:      broadcast::Sender<Arc<MusicStatePayload>>,
) {
    tokio::spawn(async move {
        const TICK: Duration = Duration::from_secs(5);
        let mut interval = tokio::time::interval(TICK);
        // Skip the immediate first tick so we don't race with startup.
        interval.tick().await;

        loop {
            interval.tick().await;

            let should_advance = {
                let guard = current.lock().await;
                match &*guard {
                    Some(t) => t.started_at.elapsed().as_secs() >= t.duration_secs as u64,
                    None    => false,
                }
            };

            if should_advance {
                start_next(&cfg, &pool, &current, &tx).await;
            }
        }
    });
}
