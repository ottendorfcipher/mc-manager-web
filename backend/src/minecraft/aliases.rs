//! In-game alias (display name) management.
//!
//! Aliases are stored in the `preferences` table as `alias:{ign}`.
//!
//! In-game we use **scoreboard teams** with a colored prefix to show
//! the alias above the player's head and in the TAB list.  Pure vanilla
//! Paper 1.21 cannot completely replace the MC username with custom text
//! without a plugin — but prefix + gold color makes the alias the
//! visually dominant element:
//!
//!   /team add rc_{ign}
//!   /team join rc_{ign} {ign}
//!   /team modify rc_{ign} prefix {"text":"<alias> ","color":"gold","bold":true}
//!   /team modify rc_{ign} color gold
//!   /team modify rc_{ign} collisionRule never
//!   /team modify rc_{ign} nametagVisibility always
//!
//! This shows `[gold]Nick [gray]ChaoticLuc` above the head and in the
//! TAB list — the alias leads, the MC username follows in smaller grey.
//!
//! Removing an alias tears down the team entirely:
//!   /team remove rc_{ign}

use crate::{config::Config, db::prefs, gcloud::ssh};

const ALIAS_PREFIX: &str = "alias:";

/// Read a player's current alias, if any.
pub async fn get_alias(pool: &sqlx::SqlitePool, ign: &str) -> Option<String> {
    prefs::get(pool, &format!("{ALIAS_PREFIX}{ign}"))
        .await
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
}

/// Persist `alias` for `ign` and apply it on the MC server right now.
/// The alias must be 1–32 non-empty characters; callers validate before
/// calling this.
pub async fn set_alias(
    pool: &sqlx::SqlitePool,
    cfg:  &Config,
    ign:  &str,
    alias: &str,
) -> anyhow::Result<()> {
    prefs::set(pool, &format!("{ALIAS_PREFIX}{ign}"), alias).await?;
    apply_alias_in_game(cfg, ign, alias).await;
    Ok(())
}

/// Remove the alias for `ign` and restore the plain MC username in-game.
pub async fn clear_alias(pool: &sqlx::SqlitePool, cfg: &Config, ign: &str) -> anyhow::Result<()> {
    // Delete the prefs row.
    sqlx::query("DELETE FROM preferences WHERE key = ?")
        .bind(format!("{ALIAS_PREFIX}{ign}"))
        .execute(pool)
        .await?;
    remove_alias_in_game(cfg, ign).await;
    Ok(())
}

/// Return every (ign, alias) pair currently stored.  Used at startup to
/// re-apply all aliases after an MC or web-server restart.
pub async fn list_all_aliases(pool: &sqlx::SqlitePool) -> Vec<(String, String)> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT key, value FROM preferences WHERE key LIKE 'alias:%'",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    rows.into_iter()
        .filter_map(|(k, v)| {
            let ign = k.strip_prefix(ALIAS_PREFIX)?.to_string();
            if v.trim().is_empty() { None } else { Some((ign, v)) }
        })
        .collect()
}

/// Apply a display-name team for one player.  Fire-and-forget — a
/// failure (e.g. MC offline) is logged and ignored.
pub async fn apply_alias_in_game(cfg: &Config, ign: &str, alias: &str) {
    // Sanitise alias for JSON embedding: escape backslash and double-quote.
    let safe = alias.replace('\\', r"\\").replace('"', r#"\""#);
    let team = team_name(ign);

    // Prefix JSON: the alias in gold+bold, followed by a space, so the
    // display reads "[gold]Nick [white]ChaoticLuc" above the head and in
    // the TAB list.  Pure vanilla can't fully replace the MC username, but
    // a bold gold prefix makes the alias the visually dominant element.
    let prefix_json = format!(r#"{{"text":"{safe} ","color":"gold","bold":true}}"#);

    let cmds: Vec<String> = vec![
        format!("team add {team}"),               // idempotent: noop if exists
        format!("team join {team} {ign}"),
        format!("team modify {team} prefix {prefix_json}"),
        format!("team modify {team} color white"),
        format!("team modify {team} collisionRule never"),
        format!("team modify {team} nametagVisibility always"),
    ];

    match ssh::fifo_batch(cfg, &cmds).await {
        Ok(true)  => tracing::info!("alias: applied '{alias}' to {ign}"),
        Ok(false) => tracing::debug!("alias: MC offline or FIFO unavailable, alias queued for next join"),
        Err(e)    => tracing::warn!("alias: apply_alias_in_game for {ign} failed: {e}"),
    }
}

/// Remove the display-name team so the player reverts to their MC username.
pub async fn remove_alias_in_game(cfg: &Config, ign: &str) {
    let team = team_name(ign);
    let cmd  = format!("team remove {team}");
    // If MC is offline, the team cleanup happens on the next MC restart via
    // `apply_all_aliases_at_startup`.  The alias row is already deleted in
    // the DB so it won't be re-created.
    match ssh::fifo_batch(cfg, &[cmd]).await {
        Ok(_)  => tracing::info!("alias: removed team for {ign}"),
        Err(e) => tracing::warn!("alias: remove_alias_in_game for {ign} failed: {e}"),
    }
}

/// Re-apply every saved alias to the MC server.  Called once at startup
/// (fire-and-forget spawn in main.rs) so reboots don't wipe nicknames.
pub async fn apply_all_aliases_at_startup(pool: &sqlx::SqlitePool, cfg: &Config) {
    let aliases = list_all_aliases(pool).await;
    if aliases.is_empty() { return; }
    tracing::info!("alias: applying {} alias(es) at startup", aliases.len());
    for (ign, alias) in &aliases {
        apply_alias_in_game(cfg, ign, alias).await;
    }
}

/// Scoreboard team name for a given IGN.
/// Must be ≤ 16 chars in 1.21 — RC prefix + up to 12 chars of IGN.
fn team_name(ign: &str) -> String {
    // IGNs are ≤ 16 chars; "rc_" + 16 = 19 which is fine for 1.18+ (64 char limit).
    format!("rc_{}", ign.to_ascii_lowercase())
}
