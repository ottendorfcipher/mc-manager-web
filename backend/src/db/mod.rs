pub mod audit;
pub mod countdowns;
pub mod settings;
pub mod backups;
pub mod chat;
pub mod kill_switch;
pub mod map_pins;
pub mod music_queue;
pub mod pending_players;
pub mod permissions;
pub mod player_snapshots;
pub mod players;
pub mod prefs;
pub mod roles;
pub mod users;
pub mod world_gamerules;
pub mod worlds;

use anyhow::Context;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::str::FromStr;

/// Initialise the SQLite connection pool and run all pending migrations.
pub async fn init(database_url: &str) -> anyhow::Result<SqlitePool> {
    // WAL mode + foreign keys enforced on every connection
    let opts = SqliteConnectOptions::from_str(database_url)
        .context("Invalid DATABASE_URL")?
        .create_if_missing(true)
        .pragma("journal_mode", "WAL")
        .pragma("foreign_keys", "ON")
        .pragma("synchronous", "NORMAL");

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await
        .context("Failed to connect to SQLite")?;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .context("Database migration failed")?;

    Ok(pool)
}
