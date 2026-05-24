//! Deploy custom dimensions via datapacks and build structures in them.
//!
//! Custom dimensions are defined in datapacks placed in the active world's
//! `datapacks/` folder.  After deployment, `/reload` loads the dimension
//! and it becomes accessible via `/execute in <namespace>:<name> ...`.

use crate::{config::Config, error::Result, gcloud::ssh, minecraft::console};

/// The Minecraft namespace for our custom dimensions.
const NAMESPACE: &str = "redstonecipher";

// ── Datapack deployment ──────────────────────────────────────────────────────

/// Deploy a custom dimension datapack to the active world on mc-server-1.
///
/// Creates the required JSON files under
/// `<server_dir>/world/datapacks/rc_<dim_name>/` and runs `/reload`.
pub async fn deploy_dimension_datapack(
    cfg: &Config,
    dim_name: &str,
) -> Result<()> {
    let server_dir = &cfg.mc_server_dir;
    let pack_dir = format!("{server_dir}/world/datapacks/rc_{dim_name}");
    let data_dir = format!("{pack_dir}/data/{NAMESPACE}");

    // pack.mcmeta
    let pack_mcmeta = serde_json::json!({
        "pack": {
            "pack_format": 26,
            "description": format!("redstoneCipher {dim_name} dimension")
        }
    });

    // dimension_type — overworld-like with sky, daylight, beds work
    let dim_type = serde_json::json!({
        "ultrawarm": false,
        "natural": true,
        "piglin_safe": false,
        "respawn_anchor_works": false,
        "bed_works": false,
        "has_raids": false,
        "has_skylight": true,
        "has_ceiling": false,
        "coordinate_scale": 1.0,
        "ambient_light": 0.0,
        "logical_height": 384,
        "effects": "minecraft:overworld",
        "infiniburn": "#minecraft:infiniburn_overworld",
        "min_y": -64,
        "height": 384,
        "monster_spawn_light_level": {
            "type": "minecraft:uniform",
            "value": { "min_inclusive": 0, "max_inclusive": 7 }
        }
    });

    // dimension — flat void world to isolate from the overworld.
    //
    // Using a superflat generator with `the_void` biome ensures:
    //   • No natural terrain, caves, or structures to explore
    //   • Biome-discovery advancements are not triggered
    //   • BlueMap / stats treat this as empty (nothing to render)
    //   • The arena is defined purely by our placed structures
    //
    // Layers: bedrock at Y=0, stone Y=1–62, grass at Y=63.
    // The forts and spawn platform sit on top at Y=64+.
    let dimension = serde_json::json!({
        "type": format!("{NAMESPACE}:{dim_name}"),
        "generator": {
            "type": "minecraft:flat",
            "settings": {
                "layers": [
                    { "block": "minecraft:bedrock",     "height": 1  },
                    { "block": "minecraft:stone",       "height": 62 },
                    { "block": "minecraft:grass_block",  "height": 1  }
                ],
                "biome": "minecraft:the_void",
                "features": false
            }
        }
    });

    // Build the script that creates all files
    let script = format!(
        r#"set -e
mkdir -p '{data_dir}/dimension_type' '{data_dir}/dimension'
cat > '{pack_dir}/pack.mcmeta' << 'MCMETA'
{pack_mcmeta}
MCMETA
cat > '{data_dir}/dimension_type/{dim_name}.json' << 'DIMTYPE'
{dim_type}
DIMTYPE
cat > '{data_dir}/dimension/{dim_name}.json' << 'DIM'
{dimension}
DIM
chown -R minecraft:minecraft '{pack_dir}' 2>/dev/null || true
echo DONE"#,
        data_dir = data_dir,
        pack_dir = pack_dir,
        pack_mcmeta = serde_json::to_string_pretty(&pack_mcmeta).unwrap(),
        dim_type = serde_json::to_string_pretty(&dim_type).unwrap(),
        dimension = serde_json::to_string_pretty(&dimension).unwrap(),
        dim_name = dim_name,
    );

    let (out, _) = ssh::run_with_timeout(
        cfg,
        &script,
        std::time::Duration::from_secs(30),
    )
    .await?;

    if !out.contains("DONE") {
        return Err(crate::error::AppError::ExternalCommand(
            "Failed to create dimension datapack".into(),
        ));
    }

    // Reload datapacks
    let _ = console::send(cfg, "reload").await;

    tracing::info!(dim_name, "Deployed dimension datapack");
    Ok(())
}

// ── Fort generation ──────────────────────────────────────────────────────────

/// Build 4 themed fort shells in the events arena dimension.
///
/// Forts are placed in the 4 quadrants of the 60×60 arena:
/// - NW (−20, −20): Desert fort — sandstone
/// - NE (+20, −20): Ice fort — packed ice / blue ice
/// - SE (+20, +20): Nether fort — nether bricks / magma
/// - SW (−20, +20): Forest fort — oak planks / logs
///
/// Each fort is roughly 10×10×8 with walls, a floor, and open top.
/// Gold nuggets (coins) are placed in chests inside each fort.
pub async fn generate_forts(
    cfg: &Config,
    dimension_id: &str,
) -> Result<()> {
    let dim = dimension_id;

    // We need to ensure chunks are loaded. Teleport a dummy entity first,
    // then run fill commands. In practice, the first player entering will
    // trigger generation. We'll use /forceload to ensure chunks exist.
    let mut cmds: Vec<String> = Vec::new();

    // Force-load the chunks in the arena
    cmds.push(format!("execute in {dim} run forceload add -30 -30 30 30"));

    // Wait a moment for chunks to generate (we'll send these in sequence)
    // Set world border for this dimension via a positioned execute
    // (world border is global, so we manage it dynamically on teleport)

    // ── Desert Fort (NW: center -15, -15) ────────────────────────────────
    // Floor
    cmds.push(format!("execute in {dim} run fill -20 64 -20 -10 64 -10 minecraft:smooth_sandstone"));
    // Walls
    cmds.push(format!("execute in {dim} run fill -20 65 -20 -20 71 -10 minecraft:sandstone"));
    cmds.push(format!("execute in {dim} run fill -10 65 -20 -10 71 -10 minecraft:sandstone"));
    cmds.push(format!("execute in {dim} run fill -20 65 -20 -10 71 -20 minecraft:sandstone"));
    cmds.push(format!("execute in {dim} run fill -20 65 -10 -10 71 -10 minecraft:sandstone"));
    // Hollow interior
    cmds.push(format!("execute in {dim} run fill -19 65 -19 -11 71 -11 minecraft:air"));
    // Entrance (2-wide, 3-tall opening)
    cmds.push(format!("execute in {dim} run fill -10 65 -16 -10 67 -14 minecraft:air"));
    // Torch lighting
    cmds.push(format!("execute in {dim} run setblock -15 66 -19 minecraft:wall_torch[facing=south]"));
    cmds.push(format!("execute in {dim} run setblock -15 66 -11 minecraft:wall_torch[facing=north]"));
    // Chest with coins
    cmds.push(format!("execute in {dim} run setblock -15 65 -15 minecraft:chest[facing=south]"));
    cmds.push(format!(
        r#"execute in {dim} run data merge block -15 65 -15 {{Items:[{{id:"minecraft:gold_nugget",Count:8b,Slot:0b,components:{{"minecraft:custom_name":'"[{{\"text\":\"Coin\",\"color\":\"gold\",\"italic\":false}}]"'}}}}]}}"#
    ));

    // ── Ice Fort (NE: center +15, -15) ───────────────────────────────────
    cmds.push(format!("execute in {dim} run fill 10 64 -20 20 64 -10 minecraft:packed_ice"));
    cmds.push(format!("execute in {dim} run fill 10 65 -20 10 71 -10 minecraft:blue_ice"));
    cmds.push(format!("execute in {dim} run fill 20 65 -20 20 71 -10 minecraft:blue_ice"));
    cmds.push(format!("execute in {dim} run fill 10 65 -20 20 71 -20 minecraft:blue_ice"));
    cmds.push(format!("execute in {dim} run fill 10 65 -10 20 71 -10 minecraft:blue_ice"));
    cmds.push(format!("execute in {dim} run fill 11 65 -19 19 71 -11 minecraft:air"));
    cmds.push(format!("execute in {dim} run fill 10 65 -16 10 67 -14 minecraft:air"));
    cmds.push(format!("execute in {dim} run setblock 15 66 -19 minecraft:wall_torch[facing=south]"));
    cmds.push(format!("execute in {dim} run setblock 15 66 -11 minecraft:wall_torch[facing=north]"));
    cmds.push(format!("execute in {dim} run setblock 15 65 -15 minecraft:chest[facing=south]"));
    cmds.push(format!(
        r#"execute in {dim} run data merge block 15 65 -15 {{Items:[{{id:"minecraft:gold_nugget",Count:8b,Slot:0b,components:{{"minecraft:custom_name":'"[{{\"text\":\"Coin\",\"color\":\"gold\",\"italic\":false}}]"'}}}}]}}"#
    ));

    // ── Nether Fort (SE: center +15, +15) ────────────────────────────────
    cmds.push(format!("execute in {dim} run fill 10 64 10 20 64 20 minecraft:magma_block"));
    cmds.push(format!("execute in {dim} run fill 10 65 10 10 71 20 minecraft:nether_bricks"));
    cmds.push(format!("execute in {dim} run fill 20 65 10 20 71 20 minecraft:nether_bricks"));
    cmds.push(format!("execute in {dim} run fill 10 65 10 20 71 10 minecraft:nether_bricks"));
    cmds.push(format!("execute in {dim} run fill 10 65 20 20 71 20 minecraft:nether_bricks"));
    cmds.push(format!("execute in {dim} run fill 11 65 11 19 71 19 minecraft:air"));
    cmds.push(format!("execute in {dim} run fill 10 65 14 10 67 16 minecraft:air"));
    cmds.push(format!("execute in {dim} run setblock 15 66 11 minecraft:wall_torch[facing=south]"));
    cmds.push(format!("execute in {dim} run setblock 15 66 19 minecraft:wall_torch[facing=north]"));
    cmds.push(format!("execute in {dim} run setblock 15 65 15 minecraft:chest[facing=south]"));
    cmds.push(format!(
        r#"execute in {dim} run data merge block 15 65 15 {{Items:[{{id:"minecraft:gold_nugget",Count:8b,Slot:0b,components:{{"minecraft:custom_name":'"[{{\"text\":\"Coin\",\"color\":\"gold\",\"italic\":false}}]"'}}}}]}}"#
    ));

    // ── Forest Fort (SW: center -15, +15) ────────────────────────────────
    cmds.push(format!("execute in {dim} run fill -20 64 10 -10 64 20 minecraft:oak_planks"));
    cmds.push(format!("execute in {dim} run fill -20 65 10 -20 71 20 minecraft:oak_log[axis=y]"));
    cmds.push(format!("execute in {dim} run fill -10 65 10 -10 71 20 minecraft:oak_log[axis=y]"));
    cmds.push(format!("execute in {dim} run fill -20 65 10 -10 71 10 minecraft:oak_planks"));
    cmds.push(format!("execute in {dim} run fill -20 65 20 -10 71 20 minecraft:oak_planks"));
    cmds.push(format!("execute in {dim} run fill -19 65 11 -11 71 19 minecraft:air"));
    cmds.push(format!("execute in {dim} run fill -10 65 14 -10 67 16 minecraft:air"));
    cmds.push(format!("execute in {dim} run setblock -15 66 11 minecraft:wall_torch[facing=south]"));
    cmds.push(format!("execute in {dim} run setblock -15 66 19 minecraft:wall_torch[facing=north]"));
    cmds.push(format!("execute in {dim} run setblock -15 65 15 minecraft:chest[facing=south]"));
    cmds.push(format!(
        r#"execute in {dim} run data merge block -15 65 15 {{Items:[{{id:"minecraft:gold_nugget",Count:8b,Slot:0b,components:{{"minecraft:custom_name":'"[{{\"text\":\"Coin\",\"color\":\"gold\",\"italic\":false}}]"'}}}}]}}"#
    ));

    // ── Central spawn platform ───────────────────────────────────────────
    cmds.push(format!("execute in {dim} run fill -2 63 -2 2 63 2 minecraft:stone_bricks"));
    cmds.push(format!("execute in {dim} run fill -1 64 -1 1 64 1 minecraft:smooth_stone"));
    // Set spawn point for the dimension
    cmds.push(format!("execute in {dim} run setworldspawn 0 65 0"));

    // ── Scoreboard for coins ─────────────────────────────────────────────
    cmds.push("scoreboard objectives add rc_coins dummy {\"text\":\"Coins\",\"color\":\"gold\"}".into());
    cmds.push("scoreboard objectives setdisplay sidebar rc_coins".into());

    // Release force-loaded chunks after a delay to let fills complete
    cmds.push(format!("execute in {dim} run forceload remove -30 -30 30 30"));

    // Send in batches (console::send_batch has a practical limit)
    for chunk in cmds.chunks(10) {
        let refs: Vec<&str> = chunk.iter().map(|s| s.as_str()).collect();
        let _ = console::send_batch(cfg, &refs).await;
        // Small delay between batches to let MC process
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    tracing::info!(dimension_id, "Generated 4 forts + spawn platform in events arena");
    Ok(())
}

/// Exclude an event dimension from BlueMap so it doesn't appear on the map.
///
/// Creates a disabled BlueMap map config and runs `bluemap unload` to
/// remove any auto-discovered maps for the dimension.
async fn exclude_from_bluemap(cfg: &Config, dim_name: &str) {
    let server_dir = &cfg.mc_server_dir;

    // BlueMap auto-discovers dimensions and creates map configs under
    // plugins/BlueMap/maps/.  The config file name uses underscores for
    // the namespace:name separator and slashes.
    // e.g. "redstonecipher:events_arena" → "redstonecipher_events_arena"
    let map_id = format!("{NAMESPACE}_{dim_name}");
    let conf_path = format!(
        "{server_dir}/plugins/BlueMap/maps/{map_id}.conf"
    );

    // Write a disabled config to prevent BlueMap from rendering this dimension.
    // If the file already exists (auto-generated), this overwrites it.
    let disabled_conf = format!(
        r#"##
## BlueMap map config — DISABLED
## This event dimension is excluded from the map.
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

    match ssh::run_with_timeout(cfg, &script, std::time::Duration::from_secs(10)).await {
        Ok((out, _)) if out.contains("DONE") => {
            tracing::info!(dim_name, "BlueMap exclusion config written");
        }
        Ok((out, err)) => {
            tracing::warn!(dim_name, out, err, "BlueMap exclusion: unexpected output");
        }
        Err(e) => {
            // Non-fatal — if BlueMap isn't installed the config dir just won't exist
            tracing::warn!(dim_name, error = %e, "BlueMap exclusion: SSH failed (non-fatal)");
        }
    }

    // Attempt to unload any already-discovered map via the console
    // (no-op if BlueMap hasn't discovered it yet)
    let _ = console::send(cfg, &format!("bluemap unload {map_id}")).await;
}

/// Set up the events arena: deploy datapack, wait for generation, build forts.
pub async fn setup_events_arena(
    cfg: &Config,
    dim_name: &str,
) -> Result<()> {
    let dimension_id = format!("{NAMESPACE}:{dim_name}");

    // 1. Deploy the datapack (flat void world — no explorable terrain)
    deploy_dimension_datapack(cfg, dim_name).await?;

    // Give MC a moment to load the datapack
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

    // 2. Exclude from BlueMap so the arena doesn't appear on the map
    exclude_from_bluemap(cfg, dim_name).await;

    // 3. Generate forts and spawn platform
    generate_forts(cfg, &dimension_id).await?;

    // 4. Disable mob spawning in the arena (peaceful game area)
    let _ = console::send(
        cfg,
        &format!("execute in {dimension_id} run gamerule doMobSpawning false"),
    )
    .await;

    // 5. Announce to players
    let _ = console::send(
        cfg,
        &format!(
            r#"tellraw @a [{{"text":"[Events] ","color":"gold","bold":true}},{{"text":"The Events Arena dimension is now available!","color":"yellow"}}]"#,
        ),
    )
    .await;

    Ok(())
}
