//! Background task that drives the Rising Oceans event.
//!
//! Architecture mirrors `countdown_runner` — in-memory active state behind a
//! Mutex, a tick loop, and a broadcast helper for SSE subscribers.

use std::sync::Arc;
use std::time::{Duration, Instant};

use sqlx::SqlitePool;
use tokio::sync::broadcast;
use tracing::warn;

use crate::{
    config::Config,
    db::rising_oceans::{self, ActiveRisingOceanPayload, RisingOceanStatePayload},
    minecraft::rising_oceans as fill,
};

// ── In-memory active state ───────────────────────────────────────────────────

#[derive(Debug)]
pub struct ActiveRisingOcean {
    pub id:            i64,
    pub center_x:      i64,
    pub center_z:      i64,
    pub radius:        i64,
    pub start_y:       i64,
    pub end_y:         i64,
    pub current_y:     i64,
    pub interval_secs: i64,
    pub backup_id:     Option<i64>,
    pub world_slug:    String,
    pub created_by:    String,
    pub paused:        bool,
    /// Monotonic instant of the last Y-level fill (or resume).
    pub last_tick_at:  Instant,
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
            id:            a.id,
            status:        if a.paused { "paused".into() } else { "running".into() },
            center_x:      a.center_x,
            center_z:      a.center_z,
            radius:        a.radius,
            start_y:       a.start_y,
            end_y:         a.end_y,
            current_y:     a.current_y,
            interval_secs: a.interval_secs,
            backup_id:     a.backup_id,
            world_slug:    a.world_slug.clone(),
            created_by:    a.created_by.clone(),
        })
    };

    let _ = tx.send(Arc::new(RisingOceanStatePayload {
        active: active_payload,
        recent,
    }));
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

            let action = {
                let guard = active.lock().await;
                match &*guard {
                    None => TickAction::Idle,
                    Some(a) if a.paused => TickAction::Idle,
                    Some(a) => {
                        let elapsed = a.last_tick_at.elapsed().as_secs() as i64;
                        if elapsed >= a.interval_secs {
                            let next_y = a.current_y + 1;
                            if next_y > a.end_y {
                                TickAction::Finish { id: a.id }
                            } else {
                                TickAction::Fill {
                                    id:       a.id,
                                    center_x: a.center_x,
                                    center_z: a.center_z,
                                    radius:   a.radius,
                                    next_y,
                                }
                            }
                        } else {
                            TickAction::Idle
                        }
                    }
                }
            };

            match action {
                TickAction::Idle => continue,

                TickAction::Fill { id, center_x, center_z, radius, next_y } => {
                    // Execute fill commands
                    if let Err(e) = fill::fill_water_level(&cfg, center_x, center_z, radius, next_y).await {
                        warn!("rising_oceans: fill Y={next_y} error: {e}");
                        // Don't stop — just log and retry next interval
                        continue;
                    }

                    // Update in-memory + DB
                    {
                        let mut guard = active.lock().await;
                        if let Some(a) = guard.as_mut() {
                            a.current_y = next_y;
                            a.last_tick_at = Instant::now();
                        }
                    }
                    if let Err(e) = rising_oceans::update_current_y(&pool, id, next_y).await {
                        warn!("rising_oceans: update_current_y error: {e}");
                    }

                    broadcast_state(&pool, &active, &tx).await;
                }

                TickAction::Finish { id } => {
                    // Mark finished
                    if let Err(e) = rising_oceans::update_status(&pool, id, "finished").await {
                        warn!("rising_oceans: finish update_status error: {e}");
                    }

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
        next_y:   i64,
    },
    Finish {
        id: i64,
    },
}
