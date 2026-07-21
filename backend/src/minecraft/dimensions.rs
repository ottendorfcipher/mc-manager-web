//! Deploy custom dimensions via datapacks and build structures in them.
//!
//! Custom dimensions are defined in datapacks placed in the active world's
//! `datapacks/` folder.  Paper requires a server restart for a new
//! dimension_type to register.  We always validate the JSON shape locally
//! before writing to disk so a missing/malformed field can't crash the server
//! on next boot (as happened with the original arena pack — it omitted the
//! `monster_spawn_block_light_limit` field that Paper 1.21+ requires).
//!
//! Two presets are provided:
//!   • `DimensionSpec::lobby` — flat platform, permanent noon, no mobs.
//!   • `DimensionSpec::arena` — flat void with grass surface (kept for
//!     backward-compat with the events-arena feature).

use std::time::Duration;

use crate::{config::Config, error::{AppError, Result}, gcloud::ssh, minecraft::console};

/// The Minecraft namespace for our custom dimensions.
pub const NAMESPACE: &str = "redstonecipher";

/// Validate a dimension name before it is interpolated into remote shell paths
/// and datapack filenames. Names are compile-time constants today (`lobby`,
/// `arena`), so this is defense in depth against a future caller passing
/// user-controlled input.
fn validate_dim_name(name: &str) -> Result<()> {
    if name.is_empty()
        || name.len() > 48
        || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(AppError::BadRequest(format!(
            "invalid dimension name '{name}'"
        )));
    }
    Ok(())
}

// ── DimensionSpec ────────────────────────────────────────────────────────────

/// Generator strategy for a custom dimension.
#[derive(Debug, Clone)]
pub enum DimensionGenerator {
    /// Superflat with explicit block layers (bottom-up).
    Flat {
        layers: Vec<(String, u32)>,
        biome:  String,
    },
}

/// Full configuration for one custom dimension.
#[derive(Debug, Clone)]
pub struct DimensionSpec {
    pub name: String,
    /// Pack description shown in `/datapack list`.
    pub description: String,
    /// Visual / atmosphere preset: `"minecraft:overworld"`, `"minecraft:the_nether"`, `"minecraft:the_end"`.
    pub effects: String,
    /// Optional locked time (e.g. `Some(6000)` for permanent noon).
    pub fixed_time: Option<i64>,
    /// 0.0–1.0 ambient indoor light. 0.0 mimics overworld, 0.3 keeps shadows lit.
    pub ambient_light: f64,
    pub has_skylight: bool,
    pub has_ceiling: bool,
    pub natural: bool,
    pub bed_works: bool,
    pub respawn_anchor_works: bool,
    pub piglin_safe: bool,
    pub has_raids: bool,
    pub ultrawarm: bool,
    pub coordinate_scale: f64,
    pub min_y: i32,
    pub height: u32,
    pub logical_height: u32,
    pub infiniburn: String,
    pub generator: DimensionGenerator,
}

impl DimensionSpec {
    /// A welcoming lobby dimension: flat platform, permanent noon, no mobs.
    pub fn lobby(name: &str) -> Self {
        Self {
            name: name.to_string(),
            description: format!("redstoneCipher {name} lobby"),
            effects: "minecraft:overworld".into(),
            fixed_time: Some(6000), // permanent noon
            ambient_light: 0.3,
            has_skylight: true,
            has_ceiling: false,
            natural: false, // no naturally regenerating sky compass, no sleep
            bed_works: false,
            respawn_anchor_works: false,
            piglin_safe: false,
            has_raids: false,
            ultrawarm: false,
            coordinate_scale: 1.0,
            min_y: 0,
            height: 256,
            logical_height: 256,
            infiniburn: "#minecraft:infiniburn_overworld".into(),
            generator: DimensionGenerator::Flat {
                layers: vec![
                    ("minecraft:bedrock".into(), 1),
                    ("minecraft:smooth_stone".into(), 1),
                    ("minecraft:white_concrete".into(), 1),
                ],
                biome: "minecraft:the_void".into(),
            },
        }
    }

    /// The events arena (kept for backward-compat with the events-arena
    /// feature recovered from earlier work).
    pub fn arena(name: &str) -> Self {
        Self {
            name: name.to_string(),
            description: format!("redstoneCipher {name} arena"),
            effects: "minecraft:overworld".into(),
            fixed_time: None,
            ambient_light: 0.0,
            has_skylight: true,
            has_ceiling: false,
            natural: true,
            bed_works: false,
            respawn_anchor_works: false,
            piglin_safe: false,
            has_raids: false,
            ultrawarm: false,
            coordinate_scale: 1.0,
            min_y: -64,
            height: 384,
            logical_height: 384,
            infiniburn: "#minecraft:infiniburn_overworld".into(),
            generator: DimensionGenerator::Flat {
                layers: vec![
                    ("minecraft:bedrock".into(), 1),
                    ("minecraft:stone".into(), 62),
                    ("minecraft:grass_block".into(), 1),
                ],
                biome: "minecraft:the_void".into(),
            },
        }
    }

    /// Full dimension ID, e.g. `"redstonecipher:lobby"`.
    pub fn dimension_id(&self) -> String {
        format!("{NAMESPACE}:{}", self.name)
    }

    /// Build the `dimension_type` JSON.  Paper 1.21+ requires both
    /// `monster_spawn_light_level` AND `monster_spawn_block_light_limit`.
    /// We always set them to 0 so mobs never spawn from light conditions.
    fn dimension_type_json(&self) -> serde_json::Value {
        let mut obj = serde_json::json!({
            "ultrawarm":                       self.ultrawarm,
            "natural":                         self.natural,
            "piglin_safe":                     self.piglin_safe,
            "respawn_anchor_works":            self.respawn_anchor_works,
            "bed_works":                       self.bed_works,
            "has_raids":                       self.has_raids,
            "has_skylight":                    self.has_skylight,
            "has_ceiling":                     self.has_ceiling,
            "coordinate_scale":                self.coordinate_scale,
            "ambient_light":                   self.ambient_light,
            "logical_height":                  self.logical_height,
            "effects":                         self.effects,
            "infiniburn":                      self.infiniburn,
            "min_y":                           self.min_y,
            "height":                          self.height,
            // Paper 1.21+ schema — both fields are REQUIRED.
            "monster_spawn_block_light_limit": 0,
            "monster_spawn_light_level":       0,
        });
        if let Some(t) = self.fixed_time {
            obj["fixed_time"] = serde_json::json!(t);
        }
        obj
    }

    fn dimension_json(&self) -> serde_json::Value {
        let generator = match &self.generator {
            DimensionGenerator::Flat { layers, biome } => {
                let layers_json: Vec<serde_json::Value> = layers
                    .iter()
                    .map(|(block, h)| serde_json::json!({ "block": block, "height": h }))
                    .collect();
                serde_json::json!({
                    "type": "minecraft:flat",
                    "settings": {
                        "layers":   layers_json,
                        "biome":    biome,
                        "features": false,
                    }
                })
            }
        };
        serde_json::json!({
            "type":      self.dimension_id(),
            "generator": generator,
        })
    }

    /// Validate that the JSON we're about to write has the fields Paper 1.21+
    /// requires.  Returns `Err` on missing/malformed entries.
    pub fn validate(&self) -> std::result::Result<(), String> {
        let t = self.dimension_type_json();
        for key in [
            "ultrawarm", "natural", "piglin_safe", "respawn_anchor_works", "bed_works",
            "has_raids", "has_skylight", "has_ceiling", "coordinate_scale", "ambient_light",
            "logical_height", "effects", "infiniburn", "min_y", "height",
            "monster_spawn_block_light_limit", "monster_spawn_light_level",
        ] {
            if t.get(key).is_none() {
                return Err(format!("missing required dimension_type field '{key}'"));
            }
        }
        if self.height as i64 + self.min_y as i64 > 2032 {
            return Err("min_y + height exceeds Paper's 2032 ceiling".into());
        }
        if self.height % 16 != 0 {
            return Err("height must be a multiple of 16".into());
        }
        Ok(())
    }
}

// ── Deployment ───────────────────────────────────────────────────────────────

/// Write the datapack files on mc-server-1 and trigger `/reload`.
///
/// NOTE: a server *restart* is required for the dimension_type registry to
/// pick up the new dimension.  `/reload` is sent so resource packs reload,
/// but the registry won't update until next boot.  Callers that need the
/// dimension available immediately should call `restart_for_dimension`.
pub async fn deploy_dimension(cfg: &Config, spec: &DimensionSpec) -> Result<()> {
    spec.validate()
        .map_err(|e| AppError::BadRequest(format!("Invalid dimension spec: {e}")))?;

    let server_dir = &cfg.mc_server_dir;
    let pack_dir   = format!("{server_dir}/world/datapacks/rc_{}", spec.name);
    let data_dir   = format!("{pack_dir}/data/{NAMESPACE}");

    let pack_mcmeta = serde_json::json!({
        "pack": {
            "pack_format": 26,
            "description": spec.description,
        }
    });

    let dim_type_pretty  = serde_json::to_string_pretty(&spec.dimension_type_json()).unwrap();
    let dimension_pretty = serde_json::to_string_pretty(&spec.dimension_json()).unwrap();
    let mcmeta_pretty    = serde_json::to_string_pretty(&pack_mcmeta).unwrap();
    let dim_name         = &spec.name;
    validate_dim_name(dim_name)?;

    let script = format!(
        r#"set -e
mkdir -p '{data_dir}/dimension_type' '{data_dir}/dimension'
cat > '{pack_dir}/pack.mcmeta' << 'MCMETA'
{mcmeta_pretty}
MCMETA
cat > '{data_dir}/dimension_type/{dim_name}.json' << 'DIMTYPE'
{dim_type_pretty}
DIMTYPE
cat > '{data_dir}/dimension/{dim_name}.json' << 'DIM'
{dimension_pretty}
DIM
chown -R minecraft:minecraft '{pack_dir}' 2>/dev/null || true
echo DONE"#,
    );

    let (out, _) = ssh::run_with_timeout(cfg, &script, Duration::from_secs(30)).await?;
    if !out.contains("DONE") {
        return Err(AppError::ExternalCommand(format!(
            "Failed to write dimension datapack: {out}"
        )));
    }

    // /reload helps for some changes; new dimension_type registries still
    // require a restart but this catches any function-pack tweaks.
    let _ = console::send(cfg, "reload").await;

    tracing::info!(dim_name = %spec.name, "Deployed dimension datapack");
    Ok(())
}

/// Remove a previously-deployed dimension's datapack.  Caller is responsible
/// for restarting MC if the dimension was already registered.
pub async fn remove_dimension(cfg: &Config, name: &str) -> Result<()> {
    validate_dim_name(name)?;
    let server_dir = &cfg.mc_server_dir;
    let pack_dir   = format!("{server_dir}/world/datapacks/rc_{name}");
    let script = format!("rm -rf '{pack_dir}' && echo DONE");
    let (out, _) = ssh::run_with_timeout(cfg, &script, Duration::from_secs(15)).await?;
    if !out.contains("DONE") {
        return Err(AppError::ExternalCommand(format!("Failed to remove datapack: {out}")));
    }
    tracing::info!(name, "Removed dimension datapack");
    Ok(())
}

/// Restart MC and verify the dimension loaded without errors.
///
/// Records the log tail offset, restarts the service, then checks the new
/// log lines for "Registry loading errors" or "Errors in element".  If found,
/// removes the offending datapack and restarts again so the server stays up.
pub async fn restart_and_verify(cfg: &Config, name: &str) -> Result<()> {
    let server_dir = &cfg.mc_server_dir;
    let log_path   = format!("{server_dir}/logs/latest.log");

    // Note current log length (lines), restart MC, wait for boot, tail since.
    let pre_lines: i64 = ssh::run_with_timeout(
        cfg,
        &format!("wc -l < '{log_path}' 2>/dev/null || echo 0"),
        Duration::from_secs(10),
    ).await.ok()
        .and_then(|(out, _)| out.trim().parse().ok())
        .unwrap_or(0);

    let restart_script = "systemctl restart minecraft && echo RESTART_OK";
    let _ = ssh::run_with_timeout(cfg, restart_script, Duration::from_secs(20)).await?;

    // Poll the log until startup completes (look for "Done (") or 60 s timeout.
    let started_at = std::time::Instant::now();
    let mut boot_ok = false;
    while started_at.elapsed() < Duration::from_secs(60) {
        tokio::time::sleep(Duration::from_secs(2)).await;
        let probe = ssh::run_with_timeout(
            cfg,
            &format!("tail -n +{} '{log_path}' 2>/dev/null | tail -100", pre_lines + 1),
            Duration::from_secs(10),
        ).await.ok();
        let recent = probe.map(|(o, _)| o).unwrap_or_default();
        if recent.contains("Registry loading errors") || recent.contains("Errors in element") {
            // Roll back the pack and restart so the server doesn't stay broken.
            tracing::error!(name, "Dimension caused registry errors — rolling back");
            let _ = remove_dimension(cfg, name).await;
            let _ = ssh::run_with_timeout(cfg, restart_script, Duration::from_secs(20)).await;
            return Err(AppError::ExternalCommand(format!(
                "Dimension '{name}' failed to load (registry errors). Datapack removed; MC restarted."
            )));
        }
        if recent.contains("Done (") {
            boot_ok = true;
            break;
        }
    }
    if !boot_ok {
        return Err(AppError::ExternalCommand(format!(
            "MC did not finish booting within 60 s after dimension '{name}' deploy"
        )));
    }
    tracing::info!(name, "Dimension verified loaded");
    Ok(())
}

// ── Legacy events-arena flow (kept for the existing rising-oceans recovery) ──

/// Set up the events arena: deploy datapack, wait for generation, build forts.
pub async fn setup_events_arena(cfg: &Config, dim_name: &str) -> Result<()> {
    let spec = DimensionSpec::arena(dim_name);
    let dimension_id = spec.dimension_id();

    deploy_dimension(cfg, &spec).await?;
    tokio::time::sleep(Duration::from_secs(3)).await;
    exclude_from_bluemap(cfg, dim_name).await;
    generate_forts(cfg, &dimension_id).await?;

    let _ = console::send(
        cfg,
        &format!("execute in {dimension_id} run gamerule doMobSpawning false"),
    ).await;
    let _ = console::send(
        cfg,
        r#"tellraw @a [{"text":"[Events] ","color":"gold","bold":true},{"text":"The Events Arena dimension is now available!","color":"yellow"}]"#,
    ).await;
    Ok(())
}

/// Build 4 themed fort shells in the events arena dimension.
/// (Kept verbatim from the recovered events-arena code so existing flows
/// continue to work.  See `setup_events_arena` for the orchestrator.)
pub async fn generate_forts(cfg: &Config, dimension_id: &str) -> Result<()> {
    let dim = dimension_id;
    let mut cmds: Vec<String> = Vec::new();
    cmds.push(format!("execute in {dim} run forceload add -30 -30 30 30"));

    // Desert Fort (NW)
    cmds.push(format!("execute in {dim} run fill -20 64 -20 -10 64 -10 minecraft:smooth_sandstone"));
    cmds.push(format!("execute in {dim} run fill -20 65 -20 -20 71 -10 minecraft:sandstone"));
    cmds.push(format!("execute in {dim} run fill -10 65 -20 -10 71 -10 minecraft:sandstone"));
    cmds.push(format!("execute in {dim} run fill -20 65 -20 -10 71 -20 minecraft:sandstone"));
    cmds.push(format!("execute in {dim} run fill -20 65 -10 -10 71 -10 minecraft:sandstone"));
    cmds.push(format!("execute in {dim} run fill -19 65 -19 -11 71 -11 minecraft:air"));
    cmds.push(format!("execute in {dim} run fill -10 65 -16 -10 67 -14 minecraft:air"));
    cmds.push(format!("execute in {dim} run setblock -15 65 -15 minecraft:chest[facing=south]"));

    // Ice Fort (NE)
    cmds.push(format!("execute in {dim} run fill 10 64 -20 20 64 -10 minecraft:packed_ice"));
    cmds.push(format!("execute in {dim} run fill 10 65 -20 10 71 -10 minecraft:blue_ice"));
    cmds.push(format!("execute in {dim} run fill 20 65 -20 20 71 -10 minecraft:blue_ice"));
    cmds.push(format!("execute in {dim} run fill 10 65 -20 20 71 -20 minecraft:blue_ice"));
    cmds.push(format!("execute in {dim} run fill 10 65 -10 20 71 -10 minecraft:blue_ice"));
    cmds.push(format!("execute in {dim} run fill 11 65 -19 19 71 -11 minecraft:air"));
    cmds.push(format!("execute in {dim} run fill 10 65 -16 10 67 -14 minecraft:air"));
    cmds.push(format!("execute in {dim} run setblock 15 65 -15 minecraft:chest[facing=south]"));

    // Nether Fort (SE)
    cmds.push(format!("execute in {dim} run fill 10 64 10 20 64 20 minecraft:magma_block"));
    cmds.push(format!("execute in {dim} run fill 10 65 10 10 71 20 minecraft:nether_bricks"));
    cmds.push(format!("execute in {dim} run fill 20 65 10 20 71 20 minecraft:nether_bricks"));
    cmds.push(format!("execute in {dim} run fill 10 65 10 20 71 10 minecraft:nether_bricks"));
    cmds.push(format!("execute in {dim} run fill 10 65 20 20 71 20 minecraft:nether_bricks"));
    cmds.push(format!("execute in {dim} run fill 11 65 11 19 71 19 minecraft:air"));
    cmds.push(format!("execute in {dim} run fill 10 65 14 10 67 16 minecraft:air"));
    cmds.push(format!("execute in {dim} run setblock 15 65 15 minecraft:chest[facing=south]"));

    // Forest Fort (SW)
    cmds.push(format!("execute in {dim} run fill -20 64 10 -10 64 20 minecraft:oak_planks"));
    cmds.push(format!("execute in {dim} run fill -20 65 10 -20 71 20 minecraft:oak_log[axis=y]"));
    cmds.push(format!("execute in {dim} run fill -10 65 10 -10 71 20 minecraft:oak_log[axis=y]"));
    cmds.push(format!("execute in {dim} run fill -20 65 10 -10 71 10 minecraft:oak_planks"));
    cmds.push(format!("execute in {dim} run fill -20 65 20 -10 71 20 minecraft:oak_planks"));
    cmds.push(format!("execute in {dim} run fill -19 65 11 -11 71 19 minecraft:air"));
    cmds.push(format!("execute in {dim} run fill -10 65 14 -10 67 16 minecraft:air"));
    cmds.push(format!("execute in {dim} run setblock -15 65 15 minecraft:chest[facing=south]"));

    // Spawn platform
    cmds.push(format!("execute in {dim} run fill -2 63 -2 2 63 2 minecraft:stone_bricks"));
    cmds.push(format!("execute in {dim} run fill -1 64 -1 1 64 1 minecraft:smooth_stone"));
    cmds.push(format!("execute in {dim} run setworldspawn 0 65 0"));
    cmds.push(format!("execute in {dim} run forceload remove -30 -30 30 30"));

    for chunk in cmds.chunks(10) {
        let refs: Vec<&str> = chunk.iter().map(|s| s.as_str()).collect();
        let _ = console::send_batch(cfg, &refs).await;
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    tracing::info!(dimension_id, "Generated 4 forts + spawn platform in events arena");
    Ok(())
}

/// Build a small lobby platform at (0, 65, 0) in the lobby dimension.
/// Called by the lobby creation flow.
pub async fn build_lobby_platform(cfg: &Config, dimension_id: &str, radius: i64) -> Result<()> {
    let dim = dimension_id;
    let r = radius.max(8) as i32;
    let mut cmds: Vec<String> = Vec::new();

    // Force-load the chunks we're about to write to.
    let r_chunk = ((r + 16) / 16).max(2);
    cmds.push(format!("execute in {dim} run forceload add {a} {a} {b} {b}",
        a = -r_chunk, b = r_chunk));

    // Floor: white concrete circle approximation (square is fine for a lobby).
    cmds.push(format!(
        "execute in {dim} run fill {a} 64 {a} {b} 64 {b} minecraft:white_concrete",
        a = -r, b = r,
    ));
    // Ring of glowstone underneath for ambient light.
    cmds.push(format!(
        "execute in {dim} run fill {a} 63 {a} {b} 63 {b} minecraft:glowstone",
        a = -r, b = r,
    ));
    // Decorative outer wall (2 blocks tall, soft glass).
    cmds.push(format!(
        "execute in {dim} run fill {a} 65 {a} {b} 66 {b} minecraft:white_stained_glass hollow",
        a = -r, b = r,
    ));
    // Centre beacon-like accent.
    cmds.push(format!("execute in {dim} run setblock 0 65 0 minecraft:sea_lantern"));
    // Spawn point in the middle of the platform.
    cmds.push(format!("execute in {dim} run setworldspawn 0 66 0"));

    // Release force-load after fills complete.
    cmds.push(format!("execute in {dim} run forceload remove {a} {a} {b} {b}",
        a = -r_chunk, b = r_chunk));

    for chunk in cmds.chunks(10) {
        let refs: Vec<&str> = chunk.iter().map(|s| s.as_str()).collect();
        let _ = console::send_batch(cfg, &refs).await;
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
    tracing::info!(dimension_id, radius, "Built lobby platform");
    Ok(())
}

/// Exclude a dimension from BlueMap so it doesn't appear on the live map.
pub async fn exclude_from_bluemap(cfg: &Config, dim_name: &str) {
    if validate_dim_name(dim_name).is_err() {
        tracing::warn!(dim_name, "exclude_from_bluemap: invalid dimension name, skipping");
        return;
    }
    let server_dir = &cfg.mc_server_dir;
    let map_id = format!("{NAMESPACE}_{dim_name}");
    let conf_path = format!("{server_dir}/plugins/BlueMap/maps/{map_id}.conf");
    let disabled_conf = format!(
        r#"##
## BlueMap map config — DISABLED
## This dimension is excluded from the map.
## Auto-managed by redstoneCipher.
##
enabled: false
name: "{NAMESPACE}:{dim_name}"
world: "world/{NAMESPACE}/{dim_name}"
"#
    );
    let script = format!(
        r#"set -e
mkdir -p '{server_dir}/plugins/BlueMap/maps' 2>/dev/null || true
cat > '{conf_path}' << 'BMCONF'
{disabled_conf}
BMCONF
chown minecraft:minecraft '{conf_path}' 2>/dev/null || true
echo DONE"#,
    );
    let _ = ssh::run_with_timeout(cfg, &script, Duration::from_secs(10)).await;
    let _ = console::send(cfg, &format!("bluemap unload {map_id}")).await;
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lobby_spec_validates() {
        DimensionSpec::lobby("lobby").validate().unwrap();
    }

    #[test]
    fn arena_spec_validates() {
        DimensionSpec::arena("arena").validate().unwrap();
    }

    #[test]
    fn dimension_type_includes_paper_1_21_required_fields() {
        let t = DimensionSpec::lobby("foo").dimension_type_json();
        // The two fields whose absence used to crash MC's registry load.
        assert!(t.get("monster_spawn_block_light_limit").is_some());
        assert!(t.get("monster_spawn_light_level").is_some());
    }

    #[test]
    fn lobby_has_fixed_time() {
        let t = DimensionSpec::lobby("foo").dimension_type_json();
        assert_eq!(t.get("fixed_time").and_then(|v| v.as_i64()), Some(6000));
    }
}

