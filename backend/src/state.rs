use sqlx::SqlitePool;
use crate::config::Config;

/// Shared state cloned into every handler via Axum's `State` extractor.
#[derive(Clone)]
pub struct AppState {
    pub pool:   SqlitePool,
    pub config: Config,
    pub http:   reqwest::Client,
}

impl AppState {
    pub fn new(pool: SqlitePool, config: Config) -> Self {
        Self {
            pool,
            config,
            http: reqwest::Client::builder()
                .user_agent("redstonecipher-server/0.1")
                .build()
                .expect("reqwest client build failed"),
        }
    }
}
