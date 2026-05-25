//! Background task that drives per-player music zones.
//!
//! Every TICK seconds:
//!   1. Refresh player snapshots (positions).
//!   2. For each enabled zone:
//!      a. For each target player (or all online players if open):
//!         • Check whether the player is inside the AABB (dimension match,
//!           x/y/z within the two corner points).
//!         • Persist `in_zone` flag.
//!         • Decide an action:
//!             - JustEntered  + cooldown OK + not playing → trigger first sound
//!             - InZone, playing, current track elapsed   → advance to next track,
//!                                                           OR if last, mark finished + start cooldown
//!             - InZone, playing, all tracks done         → already handled above
//!             - JustLeft     + stop_on_leave + playing   → stop sound, mark finished
//!             - JustLeft     + !stop_on_leave            → leave it playing
//!         • Send any required /playsound or /stopsound commands.
//!
//! Zone tracks play on the `record` channel so they never collide with vanilla
//! ambient music.  While a zone track is playing, we periodically send
//! `stopsound <player> music` to suppress the vanilla ambient soundtrack.
//!
//! Each player gets sounds via the `@p[name=IGN]` style selector so the
//! `/playsound` only reaches that one player.

use std::collections::HashMap;
use std::time::Duration;

use sqlx::SqlitePool;
use tracing::warn;

use crate::{
    config::Config,
    db::{music_queue, music_zones, player_snapshots},
    minecraft::{console, music as mc_music},
};

const TICK_SECS: u64 = 5;

// ── Entry point ──────────────────────────────────────────────────────────────

pub fn spawn_music_zone_task(cfg: Config, pool: SqlitePool) {
    tokio::spawn(async move {
        // On startup, clear all stale `is_playing` flags — sounds from the
        // previous process are no longer actually audible.  We intentionally
        // do NOT update `finished_at` so that the original cooldown window
        // is preserved instead of penalising a restart with a fresh 30-min
        // lockout.
        if let Err(e) = clear_stale_playing(&pool).await {
            warn!("music_zone: failed to clear stale playing state: {e:?}");
        }

        let mut interval = tokio::time::interval(Duration::from_secs(TICK_SECS));
        interval.tick().await; // skip the immediate first tick

        loop {
            interval.tick().await;
            if let Err(e) = tick_once(&cfg, &pool).await {
                warn!("music_zone: tick error: {e:?}");
            }
        }
    });
}

/// Reset any `is_playing = 1` rows left over from a previous process.
async fn clear_stale_playing(pool: &SqlitePool) -> anyhow::Result<()> {
    let rows = sqlx::query(
        "UPDATE music_zone_player_state SET is_playing = 0 WHERE is_playing = 1",
    )
    .execute(pool)
    .await?
    .rows_affected();
    if rows > 0 {
        tracing::info!("music_zone: cleared {rows} stale is_playing flag(s) from previous run");
    }
    Ok(())
}

// ── One tick ─────────────────────────────────────────────────────────────────

async fn tick_once(cfg: &Config, pool: &SqlitePool) -> anyhow::Result<()> {
    let zones = music_zones::list_enabled(pool).await.unwrap_or_default();
    if zones.is_empty() {
        return Ok(());
    }

    // Refresh snapshots so positions are current.  Best-effort.
    let _ = crate::minecraft::player_data::refresh_snapshots(pool, cfg).await;

    // Build sound-id → duration_secs lookup (vanilla catalog + custom tracks).
    let duration_lookup = build_duration_lookup(pool).await;

    for zone in zones {
        if let Err(e) = process_zone(cfg, pool, &zone, &duration_lookup).await {
            warn!("music_zone[{}]: {e:?}", zone.name);
        }
    }
    Ok(())
}

// ── Per-zone processing ──────────────────────────────────────────────────────

async fn process_zone(
    cfg:              &Config,
    pool:             &SqlitePool,
    zone:             &music_zones::MusicZone,
    duration_lookup:  &HashMap<String, u32>,
) -> anyhow::Result<()> {
    // Resolve target player list (None = everyone online).
    let target_igns: Option<Vec<String>> = zone.target_players_json
        .as_deref()
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
        .filter(|v| !v.is_empty());

    let sound_ids: Vec<String> = match serde_json::from_str::<Vec<String>>(&zone.sound_ids_json) {
        Ok(v) if !v.is_empty() => v,
        _ => return Ok(()),
    };

    // Fetch the candidate players' snapshots in one go.
    let candidates: Vec<player_snapshots::PlayerSnapshot> = match &target_igns {
        Some(list) => {
            let mut acc = Vec::with_capacity(list.len());
            for ign in list {
                if let Some(s) = player_snapshots::get_by_ign(pool, ign).await? {
                    acc.push(s);
                }
            }
            acc
        }
        None => player_snapshots::list(pool).await.unwrap_or_default(),
    };

    let now = chrono::Utc::now();
    let now_str = now.format("%Y-%m-%d %H:%M:%S").to_string();

    for snap in candidates {
        let inside = inside_zone(zone, &snap);

        let prev = music_zones::get_state(pool, zone.id, &snap.ign).await.unwrap_or(None);
        let was_in   = prev.as_ref().map(|s| s.in_zone == 1).unwrap_or(false);
        let playing  = prev.as_ref().map(|s| s.is_playing == 1).unwrap_or(false);
        let cur_idx  = prev.as_ref().map(|s| s.sound_index).unwrap_or(0) as usize;
        let last_finished = prev.as_ref().and_then(|s| s.finished_at.clone());

        // Cooldown check (only relevant if not currently playing)
        let cooldown_ok = match (&last_finished, zone.cooldown_secs) {
            (Some(ts), cd) if cd > 0 => {
                let parsed = chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S")
                    .ok()
                    .map(|nd| nd.and_utc());
                match parsed {
                    Some(t) => (now - t).num_seconds() >= cd,
                    None    => true,
                }
            }
            _ => true,
        };

        // Compute current track elapsed-vs-duration if we're playing.
        let track_done = if playing {
            let started = prev.as_ref()
                .and_then(|s| s.started_at.clone())
                .and_then(|ts| chrono::NaiveDateTime::parse_from_str(&ts, "%Y-%m-%d %H:%M:%S").ok())
                .map(|nd| nd.and_utc());
            if let (Some(t), Some(sid)) = (started, sound_ids.get(cur_idx)) {
                let elapsed = (now - t).num_seconds();
                let dur = duration_lookup.get(sid).copied().unwrap_or(180) as i64;
                elapsed >= dur
            } else {
                false
            }
        } else { false };

        // ── Transitions ──────────────────────────────────────────────────
        match (was_in, inside, playing, track_done) {
            // Entered (or already inside after restart/track-end), not
            // playing, cooldown OK → trigger first sound.
            (_, true, false, _) if cooldown_ok => {
                tracing::info!(
                    "music_zone[{}]: triggering for {} (was_in={was_in})",
                    zone.name, snap.ign,
                );
                let first = &sound_ids[0];
                play_for(cfg, &snap.ign, first).await;
                music_zones::upsert_state(
                    pool, zone.id, &snap.ign,
                    /*in_zone*/ true,
                    /*is_playing*/ true,
                    /*sound_index*/ 0,
                    Some(&now_str),
                    None,
                ).await?;
            }
            // Inside but cooldown still active → just record presence
            (_, true, false, _) => {
                if !was_in {
                    music_zones::set_in_zone(pool, zone.id, &snap.ign, true).await?;
                }
            }
            // Still inside, currently playing, current track ended → next/finish
            (_, true, true, true) => {
                let next_idx = cur_idx + 1;
                if let Some(next_sid) = sound_ids.get(next_idx) {
                    tracing::info!(
                        "music_zone[{}]: advancing to track {next_idx} for {}",
                        zone.name, snap.ign,
                    );
                    play_for(cfg, &snap.ign, next_sid).await;
                    music_zones::upsert_state(
                        pool, zone.id, &snap.ign,
                        /*in_zone*/ true,
                        /*is_playing*/ true,
                        next_idx as i64,
                        Some(&now_str),
                        None,
                    ).await?;
                } else {
                    // Whole sequence done → mark finished, start cooldown
                    tracing::info!(
                        "music_zone[{}]: sequence finished for {}",
                        zone.name, snap.ign,
                    );
                    music_zones::mark_finished(pool, zone.id, &snap.ign, &now_str).await?;
                    music_zones::set_in_zone(pool, zone.id, &snap.ign, true).await?;
                }
            }
            // Left the zone, playing, stop_on_leave on → stop sound + finish
            (true, false, true, _) if zone.stop_on_leave == 1 => {
                tracing::info!(
                    "music_zone[{}]: {} left zone, stopping",
                    zone.name, snap.ign,
                );
                stop_for(cfg, &snap.ign).await;
                music_zones::mark_finished(pool, zone.id, &snap.ign, &now_str).await?;
                music_zones::set_in_zone(pool, zone.id, &snap.ign, false).await?;
            }
            // Outside, still playing (stop_on_leave is off) → suppress ambient
            (_, false, true, _) => {
                if was_in {
                    music_zones::set_in_zone(pool, zone.id, &snap.ign, false).await?;
                }
                suppress_ambient(cfg, &snap.ign).await;
            }
            // Outside, not playing — record presence change
            (_, false, false, _) => {
                if was_in != inside {
                    music_zones::set_in_zone(pool, zone.id, &snap.ign, inside).await?;
                }
            }
            // Inside + playing + track not done → suppress vanilla ambient
            // music every tick so it never gets a chance to fade in.
            (_, true, true, false) => {
                suppress_ambient(cfg, &snap.ign).await;
            }
        }
    }

    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn inside_zone(zone: &music_zones::MusicZone, snap: &player_snapshots::PlayerSnapshot) -> bool {
    if snap.dimension != zone.dimension {
        return false;
    }
    // AABB check: player must be within the bounding box defined by (x1,y1,z1)→(x2,y2,z2).
    // We use min/max so the two corners can be specified in any order.
    let min_x = zone.x1.min(zone.x2) as f64;
    let max_x = zone.x1.max(zone.x2) as f64;
    let min_y = zone.y1.min(zone.y2) as f64;
    let max_y = zone.y1.max(zone.y2) as f64;
    let min_z = zone.z1.min(zone.z2) as f64;
    let max_z = zone.z1.max(zone.z2) as f64;

    snap.x >= min_x && snap.x <= max_x
        && snap.y >= min_y && snap.y <= max_y
        && snap.z >= min_z && snap.z <= max_z
}

async fn play_for(cfg: &Config, ign: &str, sound_id: &str) {
    // Use @p[name=IGN] selector so the command targets exactly one player.
    // Volume 1_000_000 = audible regardless of distance to the source.
    let sel = format!("@p[name={}]", ign);

    // Stop any previous zone track (record channel) and vanilla ambient (music channel).
    let _ = console::send(cfg, &format!("stopsound {sel} record")).await;
    match console::send(cfg, &format!("stopsound {sel} music")).await {
        Ok(true)  => {}
        Ok(false) => { warn!("music_zone: stopsound for {ign}: server offline"); return; }
        Err(e)    => { warn!("music_zone: stopsound for {ign}: {e}"); return; }
    }

    // Small pause so MC finishes processing the stop before the play arrives.
    tokio::time::sleep(Duration::from_millis(100)).await;

    // MC resource locations must be lowercase — normalise defensively.
    // Play on `record` channel to avoid collision with vanilla ambient music.
    let sid = sound_id.to_ascii_lowercase();
    match console::send(cfg, &format!("playsound {sid} record {sel} ~ ~ ~ 1000000 1")).await {
        Ok(true)  => tracing::info!("music_zone: playing {sid} for {ign} (record channel)"),
        Ok(false) => warn!("music_zone: playsound for {ign}: server offline"),
        Err(e)    => warn!("music_zone: playsound for {ign}: {e}"),
    }
}

/// Suppress vanilla ambient music for a player who has an active zone track.
/// Called every tick while `is_playing == true` so ambient never gets a chance
/// to fade in.
async fn suppress_ambient(cfg: &Config, ign: &str) {
    let sel = format!("@p[name={}]", ign);
    let _ = console::send(cfg, &format!("stopsound {sel} music")).await;
}

async fn stop_for(cfg: &Config, ign: &str) {
    let sel = format!("@p[name={}]", ign);
    // Stop zone track on the record channel.
    if let Err(e) = console::send(cfg, &format!("stopsound {sel} record")).await {
        warn!("music_zone: stopsound record for {ign}: {e}");
    }
    // Also clear any ambient suppression residue.
    let _ = console::send(cfg, &format!("stopsound {sel} music")).await;
}

/// Build a `sound_id → duration_secs` lookup combining the vanilla catalog
/// and DB-registered custom tracks.
async fn build_duration_lookup(pool: &SqlitePool) -> HashMap<String, u32> {
    let mut map = HashMap::new();
    for e in mc_music::CATALOG {
        map.insert(e.id.to_string(), e.duration_secs);
    }
    if let Ok(customs) = music_queue::list_custom_tracks(pool).await {
        for t in customs {
            map.insert(t.sound_id, t.duration_secs as u32);
        }
    }
    map
}
