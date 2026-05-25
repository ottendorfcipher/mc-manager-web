//! Background task that displays each opted-in player's nearest map pin in
//! the in-game action bar.  Runs every `TICK_SECS` seconds:
//!
//!   1. Refresh player snapshots (positions live in player_snapshots).
//!   2. For each IGN whose owner has the HUD enabled and is online:
//!      a. Resolve the user's visibility prefs (team / private toggles).
//!      b. Filter map_pins by dimension + visibility.
//!      c. Pick the nearest pin (Euclidean XZ distance).
//!      d. Send `title <ign> actionbar {…}` with arrow + label + distance.
//!
//! The action bar is intentionally unobtrusive: small grey text, single line,
//! shown above the hotbar and auto-fading after ~2s (we refresh on every tick
//! so it stays visible while the player moves).

use std::time::Duration;

use sqlx::SqlitePool;
use tracing::warn;

use crate::{
    config::Config,
    db::{map_pins, player_snapshots, prefs},
    minecraft::console,
};

const TICK_SECS: u64 = 5;

/// Spawn the background task.  Self-paced; no input channel needed.
pub fn spawn_pin_hud_task(cfg: Config, pool: SqlitePool) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(TICK_SECS));
        interval.tick().await; // skip the immediate first tick

        loop {
            interval.tick().await;
            if let Err(e) = tick_once(&cfg, &pool).await {
                warn!("pin_hud: tick error: {e:?}");
            }
        }
    });
}

async fn tick_once(cfg: &Config, pool: &SqlitePool) -> anyhow::Result<()> {
    // 1. Find all IGNs with HUD enabled (at least one toggle is "true")
    let raw: Vec<String> = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT key FROM prefs
          WHERE (key LIKE 'pin_hud:%:show_team'    AND value = 'true')
             OR (key LIKE 'pin_hud:%:show_private' AND value = 'true')
             OR (key LIKE 'pin_hud:%:show_events'  AND value = 'true')",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    // Each key is "pin_hud:{IGN}:{toggle}" — strip the prefix + suffix.
    let active_igns: Vec<String> = raw.into_iter()
        .filter_map(|k| {
            let after = k.strip_prefix("pin_hud:")?;
            let ign = after.rsplit_once(':').map(|(ign, _)| ign)?;
            Some(ign.to_string())
        })
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    if active_igns.is_empty() {
        return Ok(());
    }

    // 2. Refresh snapshots so positions are current.  Best-effort.
    let _ = crate::minecraft::player_data::refresh_snapshots(pool, cfg).await;

    for ign in active_igns {
        if let Err(e) = update_one(cfg, pool, &ign).await {
            warn!("pin_hud[{ign}]: {e:?}");
        }
    }
    Ok(())
}

async fn update_one(cfg: &Config, pool: &SqlitePool, ign: &str) -> anyhow::Result<()> {
    let snap = match player_snapshots::get_by_ign(pool, ign).await? {
        Some(s) => s,
        None    => return Ok(()), // no snapshot yet
    };

    let show_team = prefs::get(pool, &format!("pin_hud:{ign}:show_team")).await?
        .map(|v| v == "true").unwrap_or(false);
    let show_private = prefs::get(pool, &format!("pin_hud:{ign}:show_private")).await?
        .map(|v| v == "true").unwrap_or(false);
    let show_events = prefs::get(pool, &format!("pin_hud:{ign}:show_events")).await?
        .map(|v| v == "true").unwrap_or(false);
    if !show_team && !show_private && !show_events {
        return Ok(());
    }

    let owner = prefs::get(pool, &format!("pin_hud:{ign}:owner")).await?
        .unwrap_or_else(|| "".to_string());

    // Pull all pins visible to the owner; we'll filter by visibility flags below.
    let all_pins = map_pins::list(pool, &owner).await?;
    let mut candidates: Vec<_> = all_pins
        .into_iter()
        .filter(|p| {
            if p.dimension != snap.dimension { return false; }
            match p.visibility.as_str() {
                "team"    => show_team,
                "private" => show_private && p.created_by == owner,
                _         => false,
            }
        })
        .collect();

    // Synthetic pins for active events (rising oceans + launching lobbies).
    if show_events {
        if let Ok(extras) = synthetic_event_pins(pool, &snap.dimension).await {
            candidates.extend(extras);
        }
    }

    if candidates.is_empty() {
        return Ok(());
    }

    // Find nearest (XZ Euclidean — y irrelevant for navigation purposes).
    let mut best: Option<(&map_pins::MapPin, f64)> = None;
    for p in &candidates {
        let dx = p.x - snap.x;
        let dz = p.z - snap.z;
        let d  = (dx * dx + dz * dz).sqrt();
        match best {
            Some((_, bd)) if bd <= d => {}
            _ => best = Some((p, d)),
        }
    }
    let Some((pin, dist)) = best else { return Ok(()); };

    // Pick a colour that fades closer to white as you approach.
    let color = if dist < 16.0  { "#7CFFB2" }   // bright green
                else if dist < 64.0 { "#B8FFCF" }
                else if dist < 256.0 { "#FFFFFF" }
                else { "#9B9EA6" };             // far / cool grey

    let dist_str = if dist < 1.0 { "here".to_string() }
                   else if dist < 1000.0 { format!("{:.0}m", dist) }
                   else { format!("{:.1}km", dist / 1000.0) };

    // Action-bar JSON: small grey "→" arrow + label + distance.
    let json = serde_json::json!({
        "text": format!("→ {}  ({})", pin.label, dist_str),
        "color": color,
    }).to_string();

    let cmd = format!("title {ign} actionbar {json}");
    let _ = console::send(cfg, &cmd).await;
    Ok(())
}

/// Build virtual pins from currently-active events that have a known
/// location in the same dimension as `dim`.
///
/// Sources:
///   • Rising-oceans events with status='running' or 'paused' — pin at center
///   • Lobbies currently in 'launching'/'launched' state — pin at the
///     launch destination so spectators / late-joiners find the action.
async fn synthetic_event_pins(
    pool: &SqlitePool,
    dim:  &str,
) -> anyhow::Result<Vec<map_pins::MapPin>> {
    let mut out: Vec<map_pins::MapPin> = Vec::new();

    // Rising oceans
    let ros = crate::db::rising_oceans::list_recent(pool, 50).await.unwrap_or_default();
    for r in ros {
        if !matches!(r.status.as_str(), "running" | "paused") { continue; }
        // Rising oceans don't track dimension explicitly — assume overworld
        // unless a future migration adds it.  For now, only emit when the
        // player IS in the overworld so we don't surface spurious pins.
        if dim != "minecraft:overworld" { continue; }
        out.push(map_pins::MapPin {
            id:         -1_000_000 - r.id, // negative IDs avoid colliding with real pins
            x:          r.center_x as f64,
            z:          r.center_z as f64,
            dimension:  "minecraft:overworld".into(),
            label:      format!("⚠ Rising Oceans"),
            body:       None,
            icon:       "waves".into(),
            visibility: "team".into(),
            created_by: r.created_by,
            created_at: r.created_at,
            updated_at: r.started_at.unwrap_or_default(),
        });
    }

    // Lobbies launching to this dimension
    let lobbies = crate::db::lobbies::list_active(pool).await.unwrap_or_default();
    for l in lobbies {
        if l.launch_dimension != dim { continue; }
        if !matches!(l.status.as_str(), "launching" | "launched") { continue; }
        out.push(map_pins::MapPin {
            id:         -2_000_000 - l.id,
            x:          l.launch_x as f64,
            z:          l.launch_z as f64,
            dimension:  l.launch_dimension.clone(),
            label:      format!("▶ {}", l.name),
            body:       None,
            icon:       "door".into(),
            visibility: "team".into(),
            created_by: l.created_by,
            created_at: l.created_at,
            updated_at: l.launched_at.unwrap_or_default(),
        });
    }

    Ok(out)
}
