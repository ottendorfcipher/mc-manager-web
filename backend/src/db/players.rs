use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

use crate::error::{AppError, Result};

#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
#[ts(export)]
pub struct PlayerLink {
    pub id: i64,
    pub email: String,
    pub ign: String,
    pub gamemode: String,
    pub linked_at: String,
}

pub async fn list_for_user(pool: &SqlitePool, email: &str) -> Result<Vec<PlayerLink>> {
    Ok(sqlx::query_as::<_, PlayerLink>(
        "SELECT id, email, ign, gamemode, linked_at FROM player_links WHERE email = ? ORDER BY ign"
    )
    .bind(email)
    .fetch_all(pool)
    .await?)
}

pub async fn upsert(pool: &SqlitePool, email: &str, ign: &str) -> Result<()> {
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    sqlx::query(
        "INSERT INTO player_links (email, ign, linked_at) VALUES (?, ?, ?) ON CONFLICT(email, ign) DO NOTHING"
    )
    .bind(email).bind(ign).bind(&now)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn set_gamemode(
    pool: &SqlitePool,
    email: &str,
    ign: &str,
    gamemode: &str,
) -> Result<()> {
    let valid = ["survival", "creative", "adventure", "spectator"];
    if !valid.contains(&gamemode) {
        return Err(AppError::BadRequest(format!("Invalid gamemode: {gamemode}")));
    }
    sqlx::query("UPDATE player_links SET gamemode = ? WHERE email = ? AND ign = ?")
        .bind(gamemode).bind(email).bind(ign)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn remove(pool: &SqlitePool, email: &str, ign: &str) -> Result<()> {
    sqlx::query("DELETE FROM player_links WHERE email = ? AND ign = ?")
        .bind(email).bind(ign)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn replace_all(pool: &SqlitePool, email: &str, igns: &[String]) -> Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM player_links WHERE email = ?")
        .bind(email)
        .execute(&mut *tx)
        .await?;
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    for ign in igns {
        sqlx::query("INSERT INTO player_links (email, ign, linked_at) VALUES (?, ?, ?)")
            .bind(email).bind(ign).bind(&now)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}
