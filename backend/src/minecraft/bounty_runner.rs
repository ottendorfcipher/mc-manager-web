//! Background task that drives the Bounty Board event.
//!
//! Polls Minecraft stats every 30 seconds, updates the leaderboard,
//! broadcasts top player coordinates, and delivers rewards.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use sqlx::SqlitePool;
use tokio::sync::broadcast;
use tracing::{info, warn};

use crate::{
    config::Config,
    db::bounty_boards::{self, ActiveBountyBoardPayload, BountyBoardStatePayload},
    minecraft::{console, mc_stats},
};

// ── In-memory active state ──────────────────────────────────────────────────

#[derive(Debug)]
pub struct ActiveBountyBoard {
    pub id:                            i64,
    pub title:                         String,
    pub coord_broadcast_interval_secs: i64,
    pub coord_broadcast_threshold:     i64,
    pub reward_interval_secs:          i64,
    pub reward_items_json:             String,
    pub rising_oceans_id:              Option<i64>,
    pub world_slug:                    String,
    pub created_by:                    String,
    pub paused:                        bool,
    /// Monotonic instant of last stats poll.
    pub last_poll_at:                  Instant,
    /// Monotonic instant of last coordinate broadcast.
    pub last_coord_broadcast_at:       Instant,
    /// Monotonic instant of last reward delivery.
    pub last_reward_at:                Instant,
    /// Peak values for "peak" mode stats (uuid+stat_key -> max).
    pub peak_values:                   HashMap<String, i64>,
}

// ── Broadcast helper ────────────────────────────────────────────────────────

pub async fn broadcast_state(
    pool:   &SqlitePool,
    active: &tokio::sync::Mutex<Option<ActiveBountyBoard>>,
    tx:     &broadcast::Sender<Arc<BountyBoardStatePayload>>,
) {
    let recent = match bounty_boards::list_recent(pool, 20).await {
        Ok(r)  => r,
        Err(e) => { warn!("bounty_board: broadcast list_recent error: {e}"); return; }
    };

    let active_payload = {
        let guard = active.lock().await;
        match &*guard {
            None => None,
            Some(a) => {
                let stats = bounty_boards::get_tracked_stats(pool, a.id).await.unwrap_or_default();
                let leaderboard = bounty_boards::build_leaderboard(pool, a.id).await.unwrap_or_default();
                Some(ActiveBountyBoardPayload {
                    id:                            a.id,
                    title:                         a.title.clone(),
                    status:                        if a.paused { "paused".into() } else { "running".into() },
                    coord_broadcast_interval_secs: a.coord_broadcast_interval_secs,
                    coord_broadcast_threshold:     a.coord_broadcast_threshold,
                    reward_interval_secs:          a.reward_interval_secs,
                    reward_items_json:             a.reward_items_json.clone(),
                    rising_oceans_id:              a.rising_oceans_id,
                    world_slug:                    a.world_slug.clone(),
                    created_by:                    a.created_by.clone(),
                    tracked_stats:                 stats,
                    leaderboard,
                })
            }
        }
    };

    let _ = tx.send(Arc::new(BountyBoardStatePayload {
        active: active_payload,
        recent,
    }));
}

// ── Background tick loop ────────────────────────────────────────────────────

const POLL_INTERVAL_SECS: u64 = 30;

pub fn spawn_bounty_task(
    cfg:    Config,
    pool:   SqlitePool,
    active: Arc<tokio::sync::Mutex<Option<ActiveBountyBoard>>>,
    tx:     broadcast::Sender<Arc<BountyBoardStatePayload>>,
) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        interval.tick().await; // skip immediate first tick

        loop {

            crate::heartbeat::beat("bounty_runner");
            interval.tick().await;

            let action = {
                let guard = active.lock().await;
                match &*guard {
                    None => TickAction::Idle,
                    Some(a) if a.paused => TickAction::Idle,
                    Some(a) => {
                        let poll_due   = a.last_poll_at.elapsed().as_secs() >= POLL_INTERVAL_SECS;
                        let coord_due  = a.last_coord_broadcast_at.elapsed().as_secs()
                            >= a.coord_broadcast_interval_secs as u64;
                        let reward_due = a.last_reward_at.elapsed().as_secs()
                            >= a.reward_interval_secs as u64;

                        if poll_due {
                            TickAction::Poll {
                                board_id:   a.id,
                                coord_due,
                                coord_threshold: a.coord_broadcast_threshold,
                                reward_due,
                                reward_items_json: a.reward_items_json.clone(),
                            }
                        } else {
                            TickAction::Idle
                        }
                    }
                }
            };

            match action {
                TickAction::Idle => continue,

                TickAction::Poll {
                    board_id,
                    coord_due,
                    coord_threshold,
                    reward_due,
                    reward_items_json,
                } => {
                    // 1. Fetch all player stats from mc-server-1
                    let all_stats = match mc_stats::fetch_all_stats(&cfg).await {
                        Ok(s) => s,
                        Err(e) => {
                            warn!("bounty_board: fetch_all_stats error: {e}");
                            // Update last_poll_at to avoid hammering on failure
                            let mut guard = active.lock().await;
                            if let Some(a) = guard.as_mut() {
                                a.last_poll_at = Instant::now();
                            }
                            continue;
                        }
                    };

                    // 2. Get tracked stats config + baselines
                    let tracked = match bounty_boards::get_tracked_stats(&pool, board_id).await {
                        Ok(t) => t,
                        Err(e) => { warn!("bounty_board: get_tracked_stats: {e}"); continue; }
                    };

                    let baselines = match bounty_boards::get_baselines(&pool, board_id).await {
                        Ok(b) => b,
                        Err(e) => { warn!("bounty_board: get_baselines: {e}"); continue; }
                    };
                    let baseline_map: HashMap<(String, String), i64> = baselines
                        .into_iter()
                        .map(|(uuid, _ign, key, val)| ((uuid, key), val))
                        .collect();

                    // 3. Compute deltas and update scores
                    for (uuid, (ign, player_stats)) in &all_stats {
                        for ts in &tracked {
                            let raw = mc_stats::resolve_stat(player_stats, &ts.mc_paths);
                            let baseline = baseline_map
                                .get(&(uuid.clone(), ts.stat_key.clone()))
                                .copied()
                                .unwrap_or(0);

                            let delta = match ts.stat_mode.as_str() {
                                "peak" => {
                                    // For peak stats (e.g. survival time), track the max seen.
                                    // Value is in ticks for time_since_death; convert to seconds.
                                    let current = if ts.stat_key == "survival_time" {
                                        raw / 20 // ticks to seconds
                                    } else {
                                        raw
                                    };

                                    let peak_key = format!("{uuid}/{}", ts.stat_key);
                                    let mut guard = active.lock().await;
                                    if let Some(a) = guard.as_mut() {
                                        let prev = a.peak_values.get(&peak_key).copied().unwrap_or(0);
                                        let new_peak = prev.max(current);
                                        a.peak_values.insert(peak_key, new_peak);
                                        new_peak
                                    } else {
                                        current
                                    }
                                }
                                _ => {
                                    // delta mode: current - baseline
                                    (raw - baseline).max(0)
                                }
                            };

                            if let Err(e) = bounty_boards::upsert_score(
                                &pool, board_id, uuid, ign, &ts.stat_key, raw, delta,
                            ).await {
                                warn!("bounty_board: upsert_score: {e}");
                            }
                        }
                    }

                    // 4. Update last_poll_at
                    {
                        let mut guard = active.lock().await;
                        if let Some(a) = guard.as_mut() {
                            a.last_poll_at = Instant::now();
                        }
                    }

                    // 5. Build leaderboard and check actions
                    let leaderboard = bounty_boards::build_leaderboard(&pool, board_id)
                        .await
                        .unwrap_or_default();

                    let top_player = leaderboard.first();

                    // 6. Coordinate broadcast
                    if coord_due {
                        if let Some(top) = top_player {
                            if top.total_score >= coord_threshold as f64 {
                                broadcast_coords(&cfg, &top.player_ign).await;
                            }
                        }
                        let mut guard = active.lock().await;
                        if let Some(a) = guard.as_mut() {
                            a.last_coord_broadcast_at = Instant::now();
                        }
                    }

                    // 7. Reward delivery
                    if reward_due {
                        if let Some(top) = top_player {
                            if top.total_score > 0.0 {
                                deliver_reward(&cfg, &top.player_ign, &reward_items_json).await;
                            }
                        }
                        let mut guard = active.lock().await;
                        if let Some(a) = guard.as_mut() {
                            a.last_reward_at = Instant::now();
                        }
                    }

                    // 8. Broadcast updated state to SSE subscribers
                    broadcast_state(&pool, &active, &tx).await;
                }
            }
        }
    });
}

/// Broadcast the top player's coordinates to all players via chat.
async fn broadcast_coords(cfg: &Config, ign: &str) {
    // Announce the leader
    let announce = format!(
        r#"tellraw @a [{{"text":"[Bounty] ","color":"gold","bold":true}},{{"text":"The current leader {ign} has been spotted! Track them down!","color":"yellow"}}]"#,
    );
    let _ = console::send(cfg, &announce).await;

    // Show their coordinates using /execute to resolve Pos NBT
    let coord_cmd = format!(
        r#"execute as {ign} at @s run tellraw @a [{{"text":"[Bounty] ","color":"gold"}},{{"text":"{ign}'s location: ","color":"yellow"}},{{"nbt":"Pos","entity":"@s","color":"aqua"}}]"#,
    );
    let _ = console::send(cfg, &coord_cmd).await;

    info!(player = %ign, "bounty_board: broadcast coordinates");
}

/// Deliver reward items to the top player.
async fn deliver_reward(cfg: &Config, ign: &str, reward_items_json: &str) {
    let items: Vec<String> = serde_json::from_str(reward_items_json).unwrap_or_default();

    let mut commands: Vec<String> = Vec::new();

    // Announce the reward
    commands.push(format!(
        r#"tellraw @a [{{"text":"[Bounty] ","color":"gold","bold":true}},{{"text":"{ign} has earned a bounty reward!","color":"green"}}]"#,
    ));

    // Give each item
    for item_str in &items {
        // Format: "minecraft:diamond 3" or just "minecraft:diamond"
        let parts: Vec<&str> = item_str.split_whitespace().collect();
        let item_id = parts.first().copied().unwrap_or("minecraft:diamond");
        let count = parts.get(1).and_then(|s| s.parse::<u32>().ok()).unwrap_or(1);
        commands.push(format!("give {ign} {item_id} {count}"));
    }

    let cmd_refs: Vec<&str> = commands.iter().map(|s| s.as_str()).collect();
    let _ = console::send_batch(cfg, &cmd_refs).await;

    info!(player = %ign, items = %reward_items_json, "bounty_board: delivered reward");
}

enum TickAction {
    Idle,
    Poll {
        board_id:          i64,
        coord_due:         bool,
        coord_threshold:   i64,
        reward_due:        bool,
        reward_items_json: String,
    },
}
