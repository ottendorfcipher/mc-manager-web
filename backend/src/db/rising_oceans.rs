use serde::Serialize;
use sqlx::SqlitePool;
use ts_rs::TS;

use crate::error::Result;

// ── Row types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, sqlx::FromRow, Serialize, TS)]
#[ts(export)]
pub struct RisingOcean {
    pub id:                i64,
    pub status:            String,
    pub center_x:          i64,
    pub center_z:          i64,
    pub radius:            i64,
    pub start_y:           i64,
    pub end_y:             i64,
    pub current_y:         i64,
    pub interval_secs:     i64,
    /// Number of Y-levels filled per interval tick.  Ignored when
    /// `rise_pattern_json` is set.
    pub blocks_per_step:   i64,
    /// When 1, the background task continuously TPs players back inside
    /// the radius (cylindrical perimeter, all Y).
    pub perimeter_enforce: i64,
    /// Optional JSON array of per-step interval_secs overrides.  When set, the
    /// event runs exactly `len(array)` steps with these custom delays.
    pub rise_pattern_json: Option<String>,
    pub backup_id:         Option<i64>,
    pub backup_path:       Option<String>,
    pub world_slug:        String,
    pub created_by:        String,
    pub created_at:        String,
    pub started_at:        Option<String>,
    pub finished_at:       Option<String>,
    pub reverted:          Option<i64>,
}

/// Wire format for the SSE / state endpoint.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct RisingOceanStatePayload {
    pub active: Option<ActiveRisingOceanPayload>,
    pub recent: Vec<RisingOcean>,
}

/// Subset sent while an event is active.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct ActiveRisingOceanPayload {
    pub id:                i64,
    pub status:            String,
    pub center_x:          i64,
    pub center_z:          i64,
    pub radius:            i64,
    pub start_y:           i64,
    pub end_y:             i64,
    pub current_y:         i64,
    pub interval_secs:     i64,
    pub blocks_per_step:   i64,
    pub perimeter_enforce: i64,
    pub rise_pattern_json: Option<String>,
    pub backup_id:         Option<i64>,
    pub world_slug:        String,
    pub created_by:        String,
}

// ── Queries ──────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub async fn create(
    pool: &SqlitePool,
    center_x: i64,
    center_z: i64,
    radius: i64,
    start_y: i64,
    end_y: i64,
    interval_secs: i64,
    blocks_per_step: i64,
    perimeter_enforce: bool,
    rise_pattern_json: Option<&str>,
    world_slug: &str,
    created_by: &str,
) -> Result<RisingOcean> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO rising_oceans
            (center_x, center_z, radius, start_y, end_y, current_y, interval_secs,
             blocks_per_step, perimeter_enforce, rise_pattern_json, world_slug, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id",
    )
    .bind(center_x)
    .bind(center_z)
    .bind(radius)
    .bind(start_y)
    .bind(end_y)
    .bind(start_y) // current_y starts at start_y
    .bind(interval_secs)
    .bind(blocks_per_step)
    .bind(if perimeter_enforce { 1_i64 } else { 0_i64 })
    .bind(rise_pattern_json)
    .bind(world_slug)
    .bind(created_by)
    .fetch_one(pool)
    .await?;

    get(pool, id)
        .await?
        .ok_or_else(|| crate::error::AppError::Internal(anyhow::anyhow!("Row not found after insert")))
}

pub async fn get(pool: &SqlitePool, id: i64) -> Result<Option<RisingOcean>> {
    Ok(
        sqlx::query_as::<_, RisingOcean>("SELECT * FROM rising_oceans WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?,
    )
}

pub async fn list_recent(pool: &SqlitePool, limit: i64) -> Result<Vec<RisingOcean>> {
    Ok(
        sqlx::query_as::<_, RisingOcean>(
            "SELECT * FROM rising_oceans ORDER BY created_at DESC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(pool)
        .await?,
    )
}

pub async fn update_status(
    pool: &SqlitePool,
    id: i64,
    status: &str,
) -> Result<()> {
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    match status {
        "running" => {
            sqlx::query("UPDATE rising_oceans SET status = ?, started_at = ? WHERE id = ?")
                .bind(status)
                .bind(&now)
                .bind(id)
                .execute(pool)
                .await?;
        }
        "finished" | "cancelled" => {
            sqlx::query("UPDATE rising_oceans SET status = ?, finished_at = ? WHERE id = ?")
                .bind(status)
                .bind(&now)
                .bind(id)
                .execute(pool)
                .await?;
        }
        _ => {
            sqlx::query("UPDATE rising_oceans SET status = ? WHERE id = ?")
                .bind(status)
                .bind(id)
                .execute(pool)
                .await?;
        }
    }
    Ok(())
}

pub async fn update_current_y(pool: &SqlitePool, id: i64, y: i64) -> Result<()> {
    sqlx::query("UPDATE rising_oceans SET current_y = ? WHERE id = ?")
        .bind(y)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_backup(pool: &SqlitePool, id: i64, backup_id: i64, backup_path: &str) -> Result<()> {
    sqlx::query("UPDATE rising_oceans SET backup_id = ?, backup_path = ? WHERE id = ?")
        .bind(backup_id)
        .bind(backup_path)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_reverted(pool: &SqlitePool, id: i64, reverted: bool) -> Result<()> {
    sqlx::query("UPDATE rising_oceans SET reverted = ? WHERE id = ?")
        .bind(if reverted { 1i64 } else { 0i64 })
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete(pool: &SqlitePool, id: i64) -> Result<bool> {
    let rows = sqlx::query(
        "DELETE FROM rising_oceans WHERE id = ? AND status IN ('pending', 'finished', 'cancelled')",
    )
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(rows > 0)
}
