//! Background task that surfaces each opted-in player's nearest map pin as
//! a per-player **bossbar** at the top of their screen.
//!
//!   1. Refresh player snapshots (positions live in player_snapshots).
//!   2. For each IGN whose owner has the HUD enabled and is online:
//!      a. Resolve the user's visibility prefs (team / private / events).
//!      b. Filter map_pins by dimension + visibility.
//!      c. Pick the nearest pin (Euclidean XZ distance).
//!      d. Update that player's bossbar — name (arrow + label + distance),
//!         bar fill (closer = fuller, capped at 1000 m), and color.
//!   3. For any IGN that *was* showing a bossbar last tick but isn't now
//!      (opted out, no candidate pins, offline), clear its `players` list
//!      so the stale bar disappears.
//!
//! Why bossbar instead of `title actionbar`?  The Coords HUD datapack writes
//! to the action bar every game tick (20 Hz).  Anything else fighting for
//! the same slot — including the previous version of this runner — gets
//! overwritten 10× per second and only flickers through.  Bossbars are a
//! separate UI element with persistent state, so no conflict.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use sqlx::SqlitePool;
use tracing::warn;

use crate::{
    config::Config,
    db::{map_pins, player_snapshots, prefs},
    gcloud::ssh,
};

/// How often the bossbar is refreshed (name + distance + fill).
const TICK_SECS: u64 = 2;
/// How often player positions are refreshed via SSH (expensive).
const SNAPSHOT_REFRESH_SECS: u64 = 5;
/// Distance at which the bar reaches empty.  Pins farther than this still
/// show with an empty bar — we want the player to know the pin exists,
/// just that it's far.
const FAR_DIST: f64 = 1000.0;

/// Per-process bossbar bookkeeping.
///
/// MC's bossbars persist in level.dat across restarts, so we can't assume
/// a fresh slate.  Tracking what we've created in *this* process lifetime
/// avoids `bossbar add` failures on repeat ticks but tolerates an MC
/// restart wiping or duplicating bars — at worst the user sees a stale
/// bar for one tick before we overwrite it.
#[derive(Default)]
struct PinHudState {
    /// Bossbar IDs created at least once this process.
    created: HashSet<String>,
    /// IGNs whose bossbar is currently visible.  Diffed each tick so we
    /// can clear bars for players who opted out or walked into a dimension
    /// with no matching pins.
    active: HashSet<String>,
    /// Last-emitted (name_json, bar_color, bar_value) per IGN.  Lets us
    /// skip no-op `bossbar set` calls when nothing changed — MC otherwise
    /// logs "Nothing changed" to the console every tick a player is
    /// stationary.
    last_emitted: HashMap<String, (String, &'static str, i32)>,
}

/// Spawn the background task.  Self-paced; no input channel needed.
pub fn spawn_pin_hud_task(cfg: Config, pool: SqlitePool) {
    tokio::spawn(async move {
        let mut state = PinHudState::default();

        let mut interval = tokio::time::interval(Duration::from_secs(TICK_SECS));
        interval.tick().await; // skip the immediate first tick

        let mut ticks_since_refresh: u64 = SNAPSHOT_REFRESH_SECS; // force refresh on first tick

        loop {

            crate::heartbeat::beat("pin_hud_runner");
            interval.tick().await;
            ticks_since_refresh += TICK_SECS;

            let should_refresh = ticks_since_refresh >= SNAPSHOT_REFRESH_SECS;
            if should_refresh {
                ticks_since_refresh = 0;
            }

            if let Err(e) = tick_once(&cfg, &pool, should_refresh, &mut state).await {
                warn!("pin_hud: tick error: {e:?}");
            }
        }
    });
}

async fn tick_once(
    cfg:     &Config,
    pool:    &SqlitePool,
    refresh: bool,
    state:   &mut PinHudState,
) -> anyhow::Result<()> {
    // 1. Find all IGNs with HUD enabled (at least one toggle is "true").
    let raw: Vec<String> = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT key FROM preferences
          WHERE (key LIKE 'pin_hud:%:show_team'    AND value = 'true')
             OR (key LIKE 'pin_hud:%:show_private' AND value = 'true')
             OR (key LIKE 'pin_hud:%:show_events'  AND value = 'true')",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let opted_in: HashSet<String> = raw.into_iter()
        .filter_map(|k| {
            let after = k.strip_prefix("pin_hud:")?;
            let ign = after.rsplit_once(':').map(|(ign, _)| ign)?;
            Some(ign.to_string())
        })
        .collect();

    // 2. Refresh snapshots periodically — fire-and-forget so a hung SSH
    //    cannot stall the bossbar updates.
    if refresh && !opted_in.is_empty() {
        let pool2 = pool.clone();
        let cfg2  = cfg.clone();
        tokio::spawn(async move {
            let _ = crate::minecraft::player_data::refresh_snapshots(&pool2, &cfg2).await;
        });
    }

    // 3. Compute everyone who should see a bossbar this tick.
    let mut showing: Vec<PinShow> = Vec::new();
    for ign in &opted_in {
        match build_show(pool, ign).await {
            Ok(Some(s)) => showing.push(s),
            Ok(None)    => {}
            Err(e)      => warn!("pin_hud[{ign}]: {e:?}"),
        }
    }

    let target_active: HashSet<String> = showing.iter()
        .map(|s| s.ign.clone())
        .collect();

    // 4. Diff against last tick — anyone who was active and isn't now
    //    needs their bossbar cleared.
    let to_hide: Vec<String> = state.active
        .iter()
        .filter(|ign| !target_active.contains(*ign))
        .cloned()
        .collect();

    // 5. Build one batch of commands for the whole tick.
    let mut cmds: Vec<String> = Vec::new();

    for ign in &to_hide {
        let id = bossbar_id(ign);
        // Empty `players` list — bossbar still exists in MC but is hidden
        // from everyone.  Cheaper than `bossbar remove` + re-add.
        cmds.push(format!("bossbar set {id} players"));
        state.last_emitted.remove(ign);
    }

    for s in &showing {
        let id = bossbar_id(&s.ign);
        let first_time = state.created.insert(id.clone());
        let prev = state.last_emitted.get(&s.ign).cloned();
        let current = (s.name_json.clone(), s.bar_color, s.bar_value);
        let just_added = first_time;
        let just_reappeared = !state.active.contains(&s.ign);

        // First sighting this process — register the bossbar.  MC will
        // complain in console if it already exists from a prior process;
        // harmless.
        if just_added {
            cmds.push(format!("bossbar add {id} {}", initial_name_json()));
            cmds.push(format!("bossbar set {id} style progress"));
            cmds.push(format!("bossbar set {id} max 1000"));
        }

        // Only re-emit the dynamic fields when they actually changed.
        // Stationary players otherwise spam MC console with "Nothing
        // changed" every tick.
        match prev {
            Some(p) if p == current => {}
            _ => {
                cmds.push(format!("bossbar set {id} name {}", s.name_json));
                cmds.push(format!("bossbar set {id} color {}", s.bar_color));
                cmds.push(format!("bossbar set {id} value {}", s.bar_value));
            }
        }

        // `players` and `visible` only need to be reasserted when the
        // bossbar is freshly (re-)appearing.
        if just_added || just_reappeared {
            cmds.push(format!("bossbar set {id} players {}", s.ign));
            cmds.push(format!("bossbar set {id} visible true"));
        }

        state.last_emitted.insert(s.ign.clone(), current);
    }

    if !cmds.is_empty() {
        // Fire-and-forget — never block the tick loop on SSH.
        let cfg = cfg.clone();
        tokio::spawn(async move {
            let _ = ssh::fifo_batch(&cfg, &cmds).await;
        });
    }

    state.active = target_active;
    Ok(())
}

/// Everything we need to update one player's bossbar this tick.
struct PinShow {
    ign:       String,
    name_json: String,
    bar_color: &'static str,
    bar_value: i32,
}

/// Returns Some(show) when this player has a pin to display, None otherwise
/// (no snapshot, no eligible pins, all visibility toggles off).
async fn build_show(pool: &SqlitePool, ign: &str) -> anyhow::Result<Option<PinShow>> {
    let snap = match player_snapshots::get_by_ign(pool, ign).await? {
        Some(s) => s,
        None    => return Ok(None),
    };

    let show_team = prefs::get(pool, &format!("pin_hud:{ign}:show_team")).await?
        .map(|v| v == "true").unwrap_or(false);
    let show_private = prefs::get(pool, &format!("pin_hud:{ign}:show_private")).await?
        .map(|v| v == "true").unwrap_or(false);
    let show_events = prefs::get(pool, &format!("pin_hud:{ign}:show_events")).await?
        .map(|v| v == "true").unwrap_or(false);
    if !show_team && !show_private && !show_events {
        return Ok(None);
    }

    let owner = prefs::get(pool, &format!("pin_hud:{ign}:owner")).await?
        .unwrap_or_default();

    let all_pins = map_pins::list(pool, &owner).await?;
    let mut candidates: Vec<map_pins::MapPin> = all_pins
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

    if show_events {
        if let Ok(extras) = synthetic_event_pins(pool, &snap.dimension).await {
            candidates.extend(extras);
        }
    }

    if candidates.is_empty() {
        return Ok(None);
    }

    // Nearest by XZ Euclidean.
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
    let Some((pin, dist)) = best else { return Ok(None); };

    // Title text colour fades toward white as you approach.
    let text_color = if dist < 16.0  { "#7CFFB2" }   // bright green
                else if dist < 64.0  { "#B8FFCF" }
                else if dist < 256.0 { "#FFFFFF" }
                else                 { "#9B9EA6" };  // far / grey

    // Bossbar bar color from the enum MC accepts.
    let bar_color: &'static str = if dist < 16.0  { "green"  }
                             else if dist < 64.0  { "green"  }
                             else if dist < 256.0 { "blue"   }
                             else                 { "purple" };

    // Bar fill: 1000 when standing on the pin, 0 at FAR_DIST or beyond.
    let proximity = (1.0 - (dist.min(FAR_DIST) / FAR_DIST)).max(0.0);
    let bar_value = (proximity * 1000.0).round() as i32;

    let dist_str = if dist < 1.0 { "here".to_string() }
                   else if dist < 1000.0 { format!("{:.0}m", dist) }
                   else { format!("{:.1}km", dist / 1000.0) };

    let name_json = serde_json::json!({
        "text": format!("→ {}  ({})", pin.label, dist_str),
        "color": text_color,
    }).to_string();

    Ok(Some(PinShow {
        ign:       ign.to_string(),
        name_json,
        bar_color,
        bar_value,
    }))
}

/// MC bossbar IDs must be `<namespace>:<path>` where path is `[a-z0-9_/.-]+`.
/// Sanitise the IGN to fit the path grammar.
fn bossbar_id(ign: &str) -> String {
    let safe: String = ign.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' {
            c.to_ascii_lowercase()
        } else {
            '_'
        })
        .collect();
    format!("redstonecipher:pin_{safe}")
}

/// Bossbar add requires a name — we overwrite immediately so a stub is fine.
fn initial_name_json() -> &'static str {
    r#"{"text":"…","color":"gray"}"#
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
            label:      "⚠ Rising Oceans".into(),
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
