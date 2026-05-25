//! Background task that drives per-player music zones.
//!
//! Every TICK seconds:
//!   1. Refresh player snapshots (positions).
//!   2. For each enabled zone:
//!      a. For each target player (or all online players if open):
//!         • Check whether the player is inside the cylinder (dimension match,
//!           horizontal distance ≤ radius, optional Y range).
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
            // Entered the zone, not currently playing, cooldown OK → trigger
            (false, true, false, _) if cooldown_ok => {
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
            // Entered while cooldown still active → just record presence
            (false, true, false, _) => {
                music_zones::set_in_zone(pool, zone.id, &snap.ign, true).await?;
            }
            // Still inside, currently playing, current track ended → next/finish
            (_, true, true, true) => {
                let next_idx = cur_idx + 1;
                if let Some(next_sid) = sound_ids.get(next_idx) {
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
                    music_zones::mark_finished(pool, zone.id, &snap.ign, &now_str).await?;
                    music_zones::set_in_zone(pool, zone.id, &snap.ign, true).await?;
                }
            }
            // Left the zone, playing, stop_on_leave on → stop sound + finish
            (true, false, true, _) if zone.stop_on_leave == 1 => {
                stop_for(cfg, &snap.ign).await;
                music_zones::mark_finished(pool, zone.id, &snap.ign, &now_str).await?;
                music_zones::set_in_zone(pool, zone.id, &snap.ign, false).await?;
            }
            // Outside, not playing — record presence change
            (true, false, _, _) | (false, false, _, _) => {
                if was_in != inside {
                    music_zones::set_in_zone(pool, zone.id, &snap.ign, inside).await?;
                }
            }
            // Otherwise (e.g. inside + playing + not done) — just bump in_zone if changed
            _ => {
                if was_in != inside {
                    music_zones::set_in_zone(pool, zone.id, &snap.ign, inside).await?;
                }
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
    let dx = snap.x - zone.center_x as f64;
    let dz = snap.z - zone.center_z as f64;
    let r2 = (zone.radius as f64).powi(2);
    if dx * dx + dz * dz > r2 {
        return false;
    }
    if let Some(min) = zone.min_y {
        if snap.y < min as f64 { return false; }
    }
    if let Some(max) = zone.max_y {
        if snap.y > max as f64 { return false; }
    }
    true
}

async fn play_for(cfg: &Config, ign: &str, sound_id: &str) {
    // Use @p[name=IGN] selector so the command targets exactly one player.
    // Volume 1_000_000 = audible regardless of distance to the source.
    let sel = format!("@p[name={}]", ign);

    // Silence ambient / previous zone music first.
    match console::send(cfg, &format!("stopsound {sel} music")).await {
        Ok(true)  => {}
        Ok(false) => { warn!("music_zone: stopsound for {ign}: server offline"); return; }
        Err(e)    => { warn!("music_zone: stopsound for {ign}: {e}"); return; }
    }

    // Small pause so MC finishes processing the stop before the play arrives.
    tokio::time::sleep(Duration::from_millis(100)).await;

    match console::send(cfg, &format!("playsound {sound_id} music {sel} ~ ~ ~ 1000000 1")).await {
        Ok(true)  => tracing::info!("music_zone: playing {sound_id} for {ign}"),
        Ok(false) => warn!("music_zone: playsound for {ign}: server offline"),
        Err(e)    => warn!("music_zone: playsound for {ign}: {e}"),
    }
}

async fn stop_for(cfg: &Config, ign: &str) {
    let sel = format!("@p[name={}]", ign);
    if let Err(e) = console::send(cfg, &format!("stopsound {sel} music")).await {
        warn!("music_zone: stopsound for {ign}: {e}");
    }
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
