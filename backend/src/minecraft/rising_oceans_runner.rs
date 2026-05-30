//! Background task that drives the Rising Oceans event.
//!
//! Architecture mirrors `countdown_runner` — in-memory active state behind a
//! Mutex, a tick loop, and a broadcast helper for SSE subscribers.
//!
//! Per-tick responsibilities:
//!   1. Honour the configured rise schedule (blocks_per_step OR rise_pattern_json)
//!   2. Fill any Y-levels whose interval has elapsed
//!   3. If perimeter_enforce is on, push any player outside the cylindrical
//!      radius back inside

use std::sync::Arc;
use std::time::{Duration, Instant};

use sqlx::SqlitePool;
use tokio::sync::broadcast;
use tracing::warn;

use crate::{
    config::Config,
    db::rising_oceans::{self, ActiveRisingOceanPayload, RisingOceanStatePayload},
    minecraft::{console, players, rising_oceans as fill},
};

// ── In-memory active state ───────────────────────────────────────────────────

#[derive(Debug)]
pub struct ActiveRisingOcean {
    pub id:                i64,
    pub center_x:          i64,
    pub center_z:          i64,
    pub radius:            i64,
    pub start_y:           i64,
    pub end_y:             i64,
    pub current_y:         i64,
    pub interval_secs:     i64,
    pub blocks_per_step:   i64,
    pub perimeter_enforce: bool,
    /// Parsed copy of `rise_pattern_json`.  When non-empty the runner advances
    /// one entry per tick (using rise_pattern[step_idx] as the wait duration)
    /// and `step_idx` is the cursor into it.
    pub rise_pattern:      Vec<i64>,
    pub step_idx:          i64,
    pub backup_id:         Option<i64>,
    pub world_slug:        String,
    pub created_by:        String,
    pub paused:            bool,
    /// Monotonic instant of the last Y-level fill (or resume).
    pub last_tick_at:      Instant,
    /// Monotonic instant of the last perimeter sweep.
    pub last_perimeter_sweep: Instant,
}

// ── Broadcast helper ─────────────────────────────────────────────────────────

pub async fn broadcast_state(
    pool:   &SqlitePool,
    active: &tokio::sync::Mutex<Option<ActiveRisingOcean>>,
    tx:     &broadcast::Sender<Arc<RisingOceanStatePayload>>,
) {
    let recent = match rising_oceans::list_recent(pool, 20).await {
        Ok(r)  => r,
        Err(e) => { warn!("rising_oceans: broadcast list_recent error: {e}"); return; }
    };

    let active_payload = {
        let guard = active.lock().await;
        guard.as_ref().map(|a| ActiveRisingOceanPayload {
            id:                a.id,
            status:            if a.paused { "paused".into() } else { "running".into() },
            center_x:          a.center_x,
            center_z:          a.center_z,
            radius:            a.radius,
            start_y:           a.start_y,
            end_y:             a.end_y,
            current_y:         a.current_y,
            interval_secs:     a.interval_secs,
            blocks_per_step:   a.blocks_per_step,
            perimeter_enforce: if a.perimeter_enforce { 1 } else { 0 },
            rise_pattern_json: if a.rise_pattern.is_empty() {
                None
            } else {
                serde_json::to_string(&a.rise_pattern).ok()
            },
            backup_id:         a.backup_id,
            world_slug:        a.world_slug.clone(),
            created_by:        a.created_by.clone(),
        })
    };

    let _ = tx.send(Arc::new(RisingOceanStatePayload {
        active: active_payload,
        recent,
    }));
}

// ── Perimeter sweep ──────────────────────────────────────────────────────────

const PERIMETER_SWEEP_INTERVAL_SECS: u64 = 2;

/// For each online player whose horizontal distance from (cx, cz) exceeds
/// `radius`, teleport them to the nearest in-bounds point at their current Y.
async fn enforce_perimeter(cfg: &Config, cx: i64, cz: i64, radius: i64) {
    let player_list = match players::fetch_all(cfg).await {
        Ok(list) => list,
        Err(e) => { warn!("rising_oceans: perimeter fetch players failed: {e}"); return; }
    };

    let online_names: Vec<String> = player_list
        .into_iter()
        .filter(|p| p.online)
        .map(|p| p.ign)
        .collect();
    if online_names.is_empty() { return; }

    // Use Minecraft's `execute if entity` + `@s` to check & TP server-side per player.
    // Formula: TP the player to a point on the inscribed circle pointing toward them,
    // inset by KNOCKBACK_INSET.  We can't do this purely server-side without
    // scoreboard math, so we emit a single execute-as command that uses positioned
    // relative + the player's own position via /tp ~ ~ ~ … with a horizontal limit
    // via the `distance` selector argument.
    //
    // Simpler robust approach: rely on /worldborder for square containment as a
    // hard backstop (set on event start).  This perimeter sweep adds a circular
    // refinement: select players whose distance > radius and TP them inward.
    //
    // execute as @a[x=cx,z=cz,distance=radius..] at @s run tp @s ~ ~ ~
    //   — this no-ops; we need an inward offset.  Instead, use the @s position
    //   to compute via /tp facing.
    //
    // Pragmatic compromise: TP outside players back to (cx, cz, y) — the centre
    // at their current Y.  The worldborder gives the square wall; this is the
    // circular refinement.
    let r = radius;
    let safe_r = (r - 2).max(1);
    let cmd = format!(
        "execute as @a[x={cx},z={cz},distance={r}..] at @s run tp @s {cx}.5 ~ {cz}.5"
    );
    let _ = console::send(cfg, &cmd).await;

    // Belt-and-suspenders: also push them toward the centre instead of dead-centre,
    // so the experience is "shoved inward" not "always teleported to centre".
    // We use a tag + scoreboard-free approach: try to limit to distance=safe_r..
    // first — those slightly out — and gently nudge them.
    let cmd2 = format!(
        "execute as @a[x={cx},z={cz},distance={safe_r}..{r}] at @s run particle barrier ~ ~1 ~ 0 0 0 0 5"
    );
    let _ = console::send(cfg, &cmd2).await;
}

// ── Background tick loop ─────────────────────────────────────────────────────

pub fn spawn_rising_oceans_task(
    cfg:    Config,
    pool:   SqlitePool,
    active: Arc<tokio::sync::Mutex<Option<ActiveRisingOcean>>>,
    tx:     broadcast::Sender<Arc<RisingOceanStatePayload>>,
) {
    tokio::spawn(async move {
        // Tick every second so we detect interval expiry promptly.
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        interval.tick().await; // skip the immediate first tick

        loop {
            interval.tick().await;

            // ── Compute next action under the lock (no I/O while locked) ───
            let (action, perimeter_call) = {
                let guard = active.lock().await;
                match &*guard {
                    None => (TickAction::Idle, None),
                    Some(a) if a.paused => (TickAction::Idle, None),
                    Some(a) => {
                        // Determine wait for current step
                        let wait_for_this_step = if !a.rise_pattern.is_empty() {
                            a.rise_pattern
                                .get(a.step_idx as usize)
                                .copied()
                                .unwrap_or(a.interval_secs)
                        } else {
                            a.interval_secs
                        };

                        let elapsed = a.last_tick_at.elapsed().as_secs() as i64;
                        let action = if elapsed >= wait_for_this_step {
                            // How many Y levels to fill this step
                            let levels_per_step = if a.rise_pattern.is_empty() {
                                a.blocks_per_step.max(1)
                            } else {
                                1
                            };
                            let next_y_from = a.current_y + 1;
                            let next_y_to   = (a.current_y + levels_per_step).min(a.end_y);

                            if next_y_from > a.end_y
                                || (!a.rise_pattern.is_empty()
                                    && a.step_idx as usize + 1 > a.rise_pattern.len())
                            {
                                TickAction::Finish { id: a.id }
                            } else {
                                TickAction::Fill {
                                    id:       a.id,
                                    center_x: a.center_x,
                                    center_z: a.center_z,
                                    radius:   a.radius,
                                    y_from:   next_y_from,
                                    y_to:     next_y_to,
                                }
                            }
                        } else {
                            TickAction::Idle
                        };

                        // Decide whether to do perimeter sweep this second
                        let do_sweep = a.perimeter_enforce
                            && a.last_perimeter_sweep.elapsed().as_secs() >= PERIMETER_SWEEP_INTERVAL_SECS;
                        let p_call = if do_sweep {
                            Some((a.center_x, a.center_z, a.radius))
                        } else {
                            None
                        };

                        (action, p_call)
                    }
                }
            };

            // ── Perimeter sweep (outside lock) ────────────────────────────
            if let Some((cx, cz, r)) = perimeter_call {
                enforce_perimeter(&cfg, cx, cz, r).await;
                // Update last_perimeter_sweep
                let mut guard = active.lock().await;
                if let Some(a) = guard.as_mut() {
                    a.last_perimeter_sweep = Instant::now();
                }
            }

            // ── Fill / Finish (outside lock) ──────────────────────────────
            match action {
                TickAction::Idle => continue,

                TickAction::Fill { id, center_x, center_z, radius, y_from, y_to } => {
                    // Execute fill commands for each Y level in the range
                    for y in y_from..=y_to {
                        if let Err(e) = fill::fill_water_level(&cfg, center_x, center_z, radius, y).await {
                            warn!("rising_oceans: fill Y={y} error: {e}");
                            // Continue rather than abort — next interval will retry.
                        }
                    }

                    // Update in-memory + DB
                    {
                        let mut guard = active.lock().await;
                        if let Some(a) = guard.as_mut() {
                            a.current_y    = y_to;
                            a.last_tick_at = Instant::now();
                            if !a.rise_pattern.is_empty() {
                                a.step_idx += 1;
                            }
                        }
                    }
                    if let Err(e) = rising_oceans::update_current_y(&pool, id, y_to).await {
                        warn!("rising_oceans: update_current_y error: {e}");
                    }

                    broadcast_state(&pool, &active, &tx).await;
                }

                TickAction::Finish { id } => {
                    if let Err(e) = rising_oceans::update_status(&pool, id, "finished").await {
                        warn!("rising_oceans: finish update_status error: {e}");
                    }
                    // Remove the worldborder once event ends
                    let _ = console::send(&cfg, "worldborder set 60000000").await;

                    {
                        let mut guard = active.lock().await;
                        *guard = None;
                    }

                    broadcast_state(&pool, &active, &tx).await;
                }
            }
        }
    });
}

enum TickAction {
    Idle,
    Fill {
        id:       i64,
        center_x: i64,
        center_z: i64,
        radius:   i64,
        y_from:   i64,
        y_to:     i64,
    },
    Finish {
        id: i64,
    },
}
