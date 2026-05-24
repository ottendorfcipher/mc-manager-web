use std::sync::Arc;

use crate::config::Config;
use crate::db::chat::ChatMessage;
use crate::db::countdowns::CountdownStatePayload;
use crate::db::music_queue::MusicStatePayload;
use crate::discord::{DiscordRelay, DiscordRuntimeConfig};
use crate::minecraft::countdown_runner::ActiveCountdown;
use crate::minecraft::music::CurrentTrack;
use sqlx::SqlitePool;
use tokio::sync::{broadcast, watch, Mutex, RwLock};

/// Capacity of the in-memory chat broadcast channel.
/// Receivers that fall too far behind will get a lag error and should
/// reconnect + re-hydrate from /api/chat/history.
const CHAT_CHANNEL_CAPACITY: usize = 256;

/// Capacity of the music-state broadcast channel.
/// State changes are infrequent (track transitions, user actions), so a
/// small capacity is sufficient.
const MUSIC_CHANNEL_CAPACITY: usize = 32;

/// Capacity of the countdown-state broadcast channel.
const COUNTDOWN_CHANNEL_CAPACITY: usize = 32;

/// Shared state cloned into every handler via Axum's `State` extractor.
#[derive(Clone)]
pub struct AppState {
    pub pool:    SqlitePool,
    pub config:  Config,
    pub http:    reqwest::Client,
    /// Fanout channel for real-time chat events.
    pub chat_tx: broadcast::Sender<Arc<ChatMessage>>,
    /// Swappable Discord webhook relay.
    /// `None` until credentials are configured; replaced in-place when the
    /// admin saves new credentials — no service restart needed.
    pub discord: Arc<RwLock<Option<DiscordRelay>>>,
    /// Drives the gateway manager lifecycle.
    /// Send `Some(config)` to start/restart the bot; `None` to idle.
    pub discord_config_tx: Arc<watch::Sender<Option<DiscordRuntimeConfig>>>,
    /// Fanout channel for real-time music-state events (queue + now-playing).
    pub music_tx:      broadcast::Sender<Arc<MusicStatePayload>>,
    /// Ephemeral now-playing state.  `None` when nothing is playing.
    pub music_current: Arc<Mutex<Option<CurrentTrack>>>,
    /// Fanout channel for real-time countdown-state events.
    pub countdown_tx:     broadcast::Sender<Arc<CountdownStatePayload>>,
    /// Ephemeral active-countdown state.  `None` when no countdown is running.
    pub countdown_active: Arc<Mutex<Option<ActiveCountdown>>>,
}

impl AppState {
    pub fn new(
        pool:             SqlitePool,
        config:           Config,
        initial_discord:  Option<DiscordRuntimeConfig>,
    ) -> Self {
        let (chat_tx, _) = broadcast::channel(CHAT_CHANNEL_CAPACITY);
        let relay = initial_discord.as_ref().map(|cfg| DiscordRelay::new(
            cfg.webhook_url.clone(), cfg.channel_id,
        ));
        let (discord_config_tx, _) = watch::channel(initial_discord);
        let (music_tx, _) = broadcast::channel(MUSIC_CHANNEL_CAPACITY);
        let (countdown_tx, _) = broadcast::channel(COUNTDOWN_CHANNEL_CAPACITY);
        Self {
            pool,
            config,
            http: reqwest::Client::builder()
                .user_agent("redstonecipher-server/0.1")
                .build()
                .expect("reqwest client build failed"),
            chat_tx,
            discord: Arc::new(RwLock::new(relay)),
            discord_config_tx: Arc::new(discord_config_tx),
            music_tx,
            music_current: Arc::new(Mutex::new(None)),
            countdown_tx,
            countdown_active: Arc::new(Mutex::new(None)),
        }
    }
}
