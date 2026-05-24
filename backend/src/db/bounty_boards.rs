use serde::Serialize;
use sqlx::SqlitePool;
use ts_rs::TS;

use crate::error::Result;

// ── Row types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, sqlx::FromRow, Serialize, TS)]
#[ts(export)]
pub struct BountyBoard {
    pub id:                            i64,
    pub title:                         String,
    pub status:                        String,
    pub coord_broadcast_interval_secs: i64,
    pub coord_broadcast_threshold:     i64,
    pub reward_interval_secs:          i64,
    pub reward_items_json:             String,
    pub rising_oceans_id:              Option<i64>,
    pub world_slug:                    String,
    pub created_by:                    String,
    pub created_at:                    String,
    pub started_at:                    Option<String>,
    pub finished_at:                   Option<String>,
}

#[derive(Debug, Clone, sqlx::FromRow, Serialize, TS)]
#[ts(export)]
pub struct TrackedStat {
    pub id:         i64,
    pub board_id:   i64,
    pub stat_key:   String,
    pub label:      String,
    pub mc_paths:   String,   // JSON array
    pub stat_mode:  String,   // "delta" or "peak"
    pub weight:     f64,
    pub enabled:    i64,      // 0 or 1
    pub sort_order: i64,
}

#[derive(Debug, Clone, sqlx::FromRow, Serialize, TS)]
#[ts(export)]
pub struct BountyScore {
    pub board_id:    i64,
    pub player_uuid: String,
    pub player_ign:  String,
    pub stat_key:    String,
    pub raw_value:   i64,
    pub delta:       i64,
    pub updated_at:  String,
}

/// Wire format for SSE / state endpoint.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct BountyBoardStatePayload {
    pub active: Option<ActiveBountyBoardPayload>,
    pub recent: Vec<BountyBoard>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct ActiveBountyBoardPayload {
    pub id:                            i64,
    pub title:                         String,
    pub status:                        String,
    pub coord_broadcast_interval_secs: i64,
    pub coord_broadcast_threshold:     i64,
    pub reward_interval_secs:          i64,
    pub reward_items_json:             String,
    pub rising_oceans_id:              Option<i64>,
    pub world_slug:                    String,
    pub created_by:                    String,
    pub tracked_stats:                 Vec<TrackedStat>,
    pub leaderboard:                   Vec<LeaderboardEntry>,
}

/// Aggregated per-player score for the leaderboard.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct LeaderboardEntry {
    pub player_uuid:  String,
    pub player_ign:   String,
    pub total_score:  f64,
    pub stat_scores:  Vec<StatScore>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct StatScore {
    pub stat_key: String,
    pub delta:    i64,
    pub weighted: f64,
}

// ── Default tracked stats ───────────────────────────────────────────────────

pub struct DefaultStat {
    pub stat_key:  &'static str,
    pub label:     &'static str,
    pub mc_paths:  &'static str, // JSON array
    pub stat_mode: &'static str,
    pub weight:    f64,
}

pub const DEFAULT_STATS: &[DefaultStat] = &[
    DefaultStat {
        stat_key:  "diamonds_mined",
        label:     "Diamonds Mined",
        mc_paths:  r#"["minecraft:mined/minecraft:diamond_ore","minecraft:mined/minecraft:deepslate_diamond_ore"]"#,
        stat_mode: "delta",
        weight:    5.0,
    },
    DefaultStat {
        stat_key:  "mob_kills",
        label:     "Mob Kills",
        mc_paths:  r#"["minecraft:custom/minecraft:mob_kills"]"#,
        stat_mode: "delta",
        weight:    1.0,
    },
    DefaultStat {
        stat_key:  "player_kills",
        label:     "Player Kills",
        mc_paths:  r#"["minecraft:custom/minecraft:player_kills"]"#,
        stat_mode: "delta",
        weight:    10.0,
    },
    DefaultStat {
        stat_key:  "survival_time",
        label:     "Longest Survival (seconds)",
        mc_paths:  r#"["minecraft:custom/minecraft:time_since_death"]"#,
        stat_mode: "peak",
        weight:    0.1,
    },
];

// ── Queries ──────────────────────────────────────────────────────────────────

pub async fn create(
    pool: &SqlitePool,
    title: &str,
    coord_broadcast_interval_secs: i64,
    coord_broadcast_threshold: i64,
    reward_interval_secs: i64,
    reward_items_json: &str,
    rising_oceans_id: Option<i64>,
    world_slug: &str,
    created_by: &str,
) -> Result<BountyBoard> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO bounty_boards
         (title, coord_broadcast_interval_secs, coord_broadcast_threshold,
          reward_interval_secs, reward_items_json, rising_oceans_id,
          world_slug, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id",
    )
    .bind(title)
    .bind(coord_broadcast_interval_secs)
    .bind(coord_broadcast_threshold)
    .bind(reward_interval_secs)
    .bind(reward_items_json)
    .bind(rising_oceans_id)
    .bind(world_slug)
    .bind(created_by)
    .fetch_one(pool)
    .await?;

    // Seed default tracked stats
    for (i, ds) in DEFAULT_STATS.iter().enumerate() {
        sqlx::query(
            "INSERT INTO bounty_board_tracked_stats
             (board_id, stat_key, label, mc_paths, stat_mode, weight, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(ds.stat_key)
        .bind(ds.label)
        .bind(ds.mc_paths)
        .bind(ds.stat_mode)
        .bind(ds.weight)
        .bind(i as i64)
        .execute(pool)
        .await?;
    }

    get(pool, id)
        .await?
        .ok_or_else(|| crate::error::AppError::Internal(anyhow::anyhow!("Row not found after insert")))
}

pub async fn get(pool: &SqlitePool, id: i64) -> Result<Option<BountyBoard>> {
    Ok(
        sqlx::query_as::<_, BountyBoard>("SELECT * FROM bounty_boards WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?,
    )
}

pub async fn list_recent(pool: &SqlitePool, limit: i64) -> Result<Vec<BountyBoard>> {
    Ok(
        sqlx::query_as::<_, BountyBoard>(
            "SELECT * FROM bounty_boards ORDER BY created_at DESC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(pool)
        .await?,
    )
}

pub async fn get_tracked_stats(pool: &SqlitePool, board_id: i64) -> Result<Vec<TrackedStat>> {
    Ok(
        sqlx::query_as::<_, TrackedStat>(
            "SELECT * FROM bounty_board_tracked_stats WHERE board_id = ? AND enabled = 1 ORDER BY sort_order",
        )
        .bind(board_id)
        .fetch_all(pool)
        .await?,
    )
}

pub async fn update_status(pool: &SqlitePool, id: i64, status: &str) -> Result<()> {
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    match status {
        "running" => {
            sqlx::query("UPDATE bounty_boards SET status = ?, started_at = ? WHERE id = ?")
                .bind(status).bind(&now).bind(id)
                .execute(pool).await?;
        }
        "finished" | "cancelled" => {
            sqlx::query("UPDATE bounty_boards SET status = ?, finished_at = ? WHERE id = ?")
                .bind(status).bind(&now).bind(id)
                .execute(pool).await?;
        }
        _ => {
            sqlx::query("UPDATE bounty_boards SET status = ? WHERE id = ?")
                .bind(status).bind(id)
                .execute(pool).await?;
        }
    }
    Ok(())
}

pub async fn upsert_baseline(
    pool: &SqlitePool,
    board_id: i64,
    player_uuid: &str,
    player_ign: &str,
    stat_key: &str,
    baseline_value: i64,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO bounty_board_baselines (board_id, player_uuid, player_ign, stat_key, baseline_value)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(board_id, player_uuid, stat_key) DO UPDATE SET baseline_value = excluded.baseline_value",
    )
    .bind(board_id).bind(player_uuid).bind(player_ign)
    .bind(stat_key).bind(baseline_value)
    .execute(pool).await?;
    Ok(())
}

pub async fn get_baselines(
    pool: &SqlitePool,
    board_id: i64,
) -> Result<Vec<(String, String, String, i64)>> {
    // (player_uuid, player_ign, stat_key, baseline_value)
    Ok(
        sqlx::query_as::<_, (String, String, String, i64)>(
            "SELECT player_uuid, player_ign, stat_key, baseline_value
             FROM bounty_board_baselines WHERE board_id = ?",
        )
        .bind(board_id)
        .fetch_all(pool)
        .await?,
    )
}

pub async fn upsert_score(
    pool: &SqlitePool,
    board_id: i64,
    player_uuid: &str,
    player_ign: &str,
    stat_key: &str,
    raw_value: i64,
    delta: i64,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO bounty_board_scores (board_id, player_uuid, player_ign, stat_key, raw_value, delta)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(board_id, player_uuid, stat_key) DO UPDATE SET
           raw_value = excluded.raw_value, delta = excluded.delta,
           updated_at = datetime('now')",
    )
    .bind(board_id).bind(player_uuid).bind(player_ign)
    .bind(stat_key).bind(raw_value).bind(delta)
    .execute(pool).await?;
    Ok(())
}

pub async fn get_scores(pool: &SqlitePool, board_id: i64) -> Result<Vec<BountyScore>> {
    Ok(
        sqlx::query_as::<_, BountyScore>(
            "SELECT * FROM bounty_board_scores WHERE board_id = ?",
        )
        .bind(board_id)
        .fetch_all(pool)
        .await?,
    )
}

pub async fn delete(pool: &SqlitePool, id: i64) -> Result<bool> {
    let rows = sqlx::query(
        "DELETE FROM bounty_boards WHERE id = ? AND status IN ('pending', 'finished', 'cancelled')",
    )
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(rows > 0)
}

/// Build the leaderboard from scores + tracked stat weights.
pub async fn build_leaderboard(
    pool: &SqlitePool,
    board_id: i64,
) -> Result<Vec<LeaderboardEntry>> {
    let stats = get_tracked_stats(pool, board_id).await?;
    let scores = get_scores(pool, board_id).await?;

    // Build weight map
    let weights: std::collections::HashMap<&str, f64> = stats
        .iter()
        .map(|s| (s.stat_key.as_str(), s.weight))
        .collect();

    // Group scores by player
    let mut by_player: std::collections::HashMap<String, (String, Vec<StatScore>)> =
        std::collections::HashMap::new();

    for sc in &scores {
        let w = weights.get(sc.stat_key.as_str()).copied().unwrap_or(1.0);
        let entry = by_player
            .entry(sc.player_uuid.clone())
            .or_insert_with(|| (sc.player_ign.clone(), Vec::new()));
        entry.1.push(StatScore {
            stat_key: sc.stat_key.clone(),
            delta:    sc.delta,
            weighted: sc.delta as f64 * w,
        });
    }

    let mut leaderboard: Vec<LeaderboardEntry> = by_player
        .into_iter()
        .map(|(uuid, (ign, stat_scores))| {
            let total: f64 = stat_scores.iter().map(|s| s.weighted).sum();
            LeaderboardEntry {
                player_uuid: uuid,
                player_ign:  ign,
                total_score: total,
                stat_scores,
            }
        })
        .collect();

    leaderboard.sort_by(|a, b| b.total_score.partial_cmp(&a.total_score).unwrap_or(std::cmp::Ordering::Equal));

    Ok(leaderboard)
}
