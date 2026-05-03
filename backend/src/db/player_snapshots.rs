use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;
use crate::error::Result;

#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct PlayerSnapshot {
    pub id:             i64,
    pub uuid:           String,
    pub ign:            String,
    pub x:              f64,
    pub y:              f64,
    pub z:              f64,
    pub yaw:            f64,
    pub dimension:      String,
    /// JSON array of `{ id, count, slot }` objects
    pub inventory_json: String,
    pub health:         f64,
    pub captured_at:    String,
}

pub async fn list(pool: &SqlitePool) -> Result<Vec<PlayerSnapshot>> {
    Ok(sqlx::query_as::<_, PlayerSnapshot>(
        "SELECT id, uuid, ign, x, y, z, yaw, dimension, inventory_json, health, captured_at
         FROM player_snapshots ORDER BY ign ASC"
    )
    .fetch_all(pool)
    .await?)
}

pub async fn get_by_ign(pool: &SqlitePool, ign: &str) -> Result<Option<PlayerSnapshot>> {
    Ok(sqlx::query_as::<_, PlayerSnapshot>(
        "SELECT id, uuid, ign, x, y, z, yaw, dimension, inventory_json, health, captured_at
         FROM player_snapshots WHERE ign = ?"
    )
    .bind(ign)
    .fetch_optional(pool)
    .await?)
}

pub async fn upsert(
    pool:       &SqlitePool,
    uuid:       &str,
    ign:        &str,
    x:          f64,
    y:          f64,
    z:          f64,
    yaw:        f64,
    dimension:  &str,
    inv_json:   &str,
    health:     f64,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO player_snapshots
             (uuid, ign, x, y, z, yaw, dimension, inventory_json, health, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
         ON CONFLICT(ign) DO UPDATE SET
             uuid           = excluded.uuid,
             x              = excluded.x,
             y              = excluded.y,
             z              = excluded.z,
             yaw            = excluded.yaw,
             dimension      = excluded.dimension,
             inventory_json = excluded.inventory_json,
             health         = excluded.health,
             captured_at    = excluded.captured_at"
    )
    .bind(uuid)
    .bind(ign)
    .bind(x).bind(y).bind(z).bind(yaw)
    .bind(dimension)
    .bind(inv_json)
    .bind(health)
    .execute(pool)
    .await?;
    Ok(())
}
