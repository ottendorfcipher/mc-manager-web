//! Generate Minecraft `/fill` commands to raise water at a given Y level.
//!
//! The `/fill` command has a 32 768-block volume limit.  For a single Y layer
//! the area is `(2R)²` blocks, so large radii must be split into strips that
//! each fit under the limit.

use crate::{config::Config, error::Result, minecraft::console};

/// Maximum blocks per `/fill` command.
const FILL_LIMIT: i64 = 32_768;

/// Generate the `/fill` commands needed to fill a single Y layer with water.
///
/// Returns a list of commands like:
///   `fill <x1> <y> <z1> <x2> <y> <z2> water replace air`
///
/// The area is split into Z-axis strips to stay under the 32 768-block limit.
pub fn fill_commands(center_x: i64, center_z: i64, radius: i64, y: i64) -> Vec<String> {
    let x1 = center_x - radius;
    let x2 = center_x + radius - 1;
    let z_min = center_z - radius;
    let z_max = center_z + radius - 1;

    let width = x2 - x1 + 1; // 2 * radius
    let strip_depth = (FILL_LIMIT / width).max(1);

    let mut cmds = Vec::new();
    let mut z = z_min;
    while z <= z_max {
        let z_end = (z + strip_depth - 1).min(z_max);
        cmds.push(format!(
            "fill {x1} {y} {z} {x2} {y} {z_end} water replace air"
        ));
        z = z_end + 1;
    }
    cmds
}

/// Execute the fill commands for one Y level via the console FIFO.
pub async fn fill_water_level(
    cfg: &Config,
    center_x: i64,
    center_z: i64,
    radius: i64,
    y: i64,
) -> Result<bool> {
    let cmds = fill_commands(center_x, center_z, radius, y);
    let refs: Vec<&str> = cmds.iter().map(|s| s.as_str()).collect();
    console::send_batch(cfg, &refs).await
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_radius_single_command() {
        let cmds = fill_commands(0, 0, 64, 70);
        // 128 * 128 = 16384 < 32768 → one command
        assert_eq!(cmds.len(), 1);
        assert!(cmds[0].contains("fill -64 70 -64 63 70 63 water replace air"));
    }

    #[test]
    fn large_radius_multiple_strips() {
        let cmds = fill_commands(0, 0, 256, 80);
        // 512 * 512 = 262_144, strip_depth = 32768/512 = 64
        // 512 / 64 = 8 strips
        assert_eq!(cmds.len(), 8);
        for cmd in &cmds {
            assert!(cmd.starts_with("fill "));
            assert!(cmd.ends_with("water replace air"));
            assert!(cmd.contains(" 80 "));
        }
    }

    #[test]
    fn off_center_coordinates() {
        let cmds = fill_commands(100, -200, 32, 65);
        // 64 * 64 = 4096 < 32768 → one command
        assert_eq!(cmds.len(), 1);
        assert!(cmds[0].contains("fill 68 65 -232 131 65 -169 water replace air"));
    }

    #[test]
    fn strips_cover_full_area() {
        let cmds = fill_commands(0, 0, 256, 70);
        // Verify the Z ranges are contiguous and cover [-256, 255]
        let mut z_covered = 0i64;
        for cmd in &cmds {
            let parts: Vec<&str> = cmd.split_whitespace().collect();
            // fill x1 y z1 x2 y z2 water replace air
            let z1: i64 = parts[3].parse().unwrap();
            let z2: i64 = parts[6].parse().unwrap();
            z_covered += z2 - z1 + 1;
        }
        assert_eq!(z_covered, 512); // 2 * 256
    }
}
