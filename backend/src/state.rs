use std::sync::Arc;

use crate::config::Config;
use crate::db::chat::ChatMessage;
use sqlx::SqlitePool;
use tokio::sync::broadcast;

/// Capacity of the in-memory chat broadcast channel.
/// Receivers that fall too far behind will get a lag error and should
/// reconnect + re-hydrate from /api/chat/history.
const CHAT_CHANNEL_CAPACITY: usize = 256;

/// Shared state cloned into every handler via Axum's `State` extractor.
#[derive(Clone)]
pub struct AppState {
    pub pool:    SqlitePool,
    pub config:  Config,
    pub http:    reqwest::Client,
    /// Fanout channel for real-time chat events.
    /// Handlers subscribe to this for the SSE stream; the watcher and
    /// send handler publish to it.
    pub chat_tx: broadcast::Sender<Arc<ChatMessage>>,
}

impl AppState {
    pub fn new(pool: SqlitePool, config: Config) -> Self {
        let (chat_tx, _) = broadcast::channel(CHAT_CHANNEL_CAPACITY);
        Self {
            pool,
            config,
            http: reqwest::Client::builder()
                .user_agent("redstonecipher-server/0.1")
                .build()
                .expect("reqwest client build failed"),
            chat_tx,
        }
    }
}
