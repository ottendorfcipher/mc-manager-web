//! Discord ↔ Web ↔ Minecraft three-way chat bridge.
//!
//! ## Architecture
//!
//! **Outbound (MC/Web → Discord):** `DiscordRelay::relay()` POSTs to a Discord
//! webhook URL.  Each call supplies a custom `username` and optional `avatar_url`
//! so Minecraft players appear as themselves in Discord (MC head as avatar, IGN
//! as name) and web users appear under their portal display name and Google avatar.
//!
//! **Inbound (Discord → Web + MC):** A Serenity bot gateway task listens for
//! messages in the configured channel, persists them to `chat_messages` with
//! `source="discord"`, broadcasts them to SSE subscribers (web UI), and mirrors
//! them to Minecraft via the FIFO pipe as a colour-coded `tellraw` command.
//!
//! ## Loop prevention
//! * The gateway handler ignores bot-authored messages.
//! * Discord-originated messages are never passed back to `relay()`.
//! * `tellraw` output does not appear in `latest.log` as player chat, so the
//!   chat watcher can never echo a relayed message back to Discord.

use std::sync::Arc;
use std::time::Duration;

use serenity::async_trait;
use serenity::model::channel::Message;
use serenity::model::gateway::{GatewayIntents, Ready};
use serenity::prelude::*;
use tokio::sync::{broadcast, watch};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::config::Config;
use crate::db::chat::{self, ChatMessage};
use crate::gcloud::ssh;

// ── Runtime configuration (shared between relay + gateway) ────────────────────

/// All three Discord credentials resolved at runtime (from DB or env vars).
/// Stored in a `watch` channel so both the relay and the gateway manager
/// can react immediately when an admin saves new credentials in the UI.
#[derive(Debug, Clone, PartialEq)]
pub struct DiscordRuntimeConfig {
    pub bot_token:   String,
    pub webhook_url: String,
    pub channel_id:  u64,
}

// ── Outbound: webhook relay ───────────────────────────────────────────────────

/// Shared handle for relaying messages *to* Discord via a webhook.
///
/// Stored as `Option<Arc<DiscordRelay>>` on `AppState` and cheap to clone
/// into handlers and background tasks.
#[derive(Clone)]
pub struct DiscordRelay {
    webhook_url: String,
    http:        reqwest::Client,
}

impl DiscordRelay {
    /// Create a relay backed by its own `reqwest::Client` (avoids coupling to
    /// the main app's HTTP client lifecycle).
    pub fn new(webhook_url: String, _channel_id: u64) -> Self {
        let http = reqwest::Client::builder()
            .user_agent("redstonecipher-discord/0.1")
            .timeout(Duration::from_secs(10))
            .build()
            .expect("Discord reqwest client build failed");
        Self { webhook_url, http }
    }

    /// POST a message to Discord via the configured webhook.
    ///
    /// * `username`   — displayed as the sender name in Discord
    /// * `avatar_url` — sender avatar; `None` uses the webhook's default icon
    /// * `content`    — message body (truncated to 1900 chars if needed)
    ///
    /// Errors are logged but never propagated — Discord failures must not break
    /// the originating send path.
    pub async fn relay(&self, username: &str, avatar_url: Option<&str>, content: &str) {
        // Discord caps webhook payloads at 2000 chars; leave headroom for overhead.
        let body = if content.len() > 1900 { &content[..1900] } else { content };

        let mut payload = serde_json::json!({
            "username": username,
            "content":  body,
        });
        if let Some(url) = avatar_url {
            payload["avatar_url"] = serde_json::Value::String(url.to_string());
        }

        match self.http.post(&self.webhook_url).json(&payload).send().await {
            Ok(r) if r.status().is_success() => {}
            Ok(r)  => warn!(status = %r.status(), "Discord webhook non-2xx"),
            Err(e) => warn!("Discord webhook error: {e}"),
        }
    }
}

// ── Inbound: Serenity event handler ──────────────────────────────────────────

struct DiscordHandler {
    channel_id: u64,
    pool:       sqlx::SqlitePool,
    chat_tx:    broadcast::Sender<Arc<ChatMessage>>,
    config:     Config,
}

#[async_trait]
impl EventHandler for DiscordHandler {
    async fn message(&self, _ctx: Context, msg: Message) {
        // Ignore bot messages (loop prevention) and wrong channel.
        if msg.author.bot || msg.channel_id.get() != self.channel_id {
            return;
        }

        let username = msg.author.name.clone();
        let content  = msg.content.clone();

        // 1. Persist with source="discord" and broadcast to SSE subscribers.
        match chat::insert(&self.pool, "discord", &username, &username, &content).await {
            Ok(chat_msg) => { let _ = self.chat_tx.send(Arc::new(chat_msg)); }
            Err(e) => {
                warn!("Discord inbound: DB insert failed: {e}");
                return;
            }
        }

        // 2. Mirror to Minecraft in-game via FIFO pipe.
        //    tellraw output does NOT appear in latest.log as player chat,
        //    so this cannot trigger a secondary relay back to Discord.
        let tellraw = build_discord_tellraw(&username, &content);
        let cmd = format!("tellraw @a {tellraw}");
        if let Err(e) = ssh::fifo_command(&self.config, &cmd).await {
            // Server being offline is expected and not an error.
            warn!("Discord inbound: FIFO relay failed (server offline?): {e}");
        }
    }

    async fn ready(&self, _ctx: Context, ready: Ready) {
        info!("Discord bot connected as \"{}\"", ready.user.name);
    }
}

// ── Gateway manager (hot-reload) ─────────────────────────────────────────────

/// Spawn a long-running gateway manager task that watches `config_rx` and
/// restarts the Serenity client whenever the credentials change.
///
/// - `None` on the channel → idle (no bot token configured yet)
/// - `Some(cfg)` → build + start a Serenity client; cancel it when the
///   config changes, then loop with the new credentials.
///
/// Call this once from `main()` alongside `chat_watcher::spawn()`.
pub fn spawn_manager(
    mut config_rx: watch::Receiver<Option<DiscordRuntimeConfig>>,
    config:        Config,
    pool:          sqlx::SqlitePool,
    chat_tx:       broadcast::Sender<Arc<ChatMessage>>,
) {
    tokio::spawn(async move {
        loop {
            let current = config_rx.borrow_and_update().clone();

            match current {
                None => {
                    // No credentials configured yet — wait for them.
                    if config_rx.changed().await.is_err() { break; }
                }
                Some(cfg) => {
                    let cancel = CancellationToken::new();
                    let cancel_clone = cancel.clone();

                    // Spawn the Serenity client in its own task so we can
                    // select! between it finishing and a config change.
                    let pool_clone    = pool.clone();
                    let chat_clone    = chat_tx.clone();
                    let config_clone  = config.clone();
                    let token_str     = cfg.bot_token.clone();
                    let channel_id    = cfg.channel_id;

                    let handle = tokio::spawn(async move {
                        let handler = DiscordHandler {
                            channel_id,
                            pool: pool_clone,
                            chat_tx: chat_clone,
                            config: config_clone,
                        };
                        let intents = GatewayIntents::GUILD_MESSAGES
                            | GatewayIntents::MESSAGE_CONTENT;

                        let mut client = match Client::builder(&token_str, intents)
                            .event_handler(handler)
                            .await
                        {
                            Ok(c)  => c,
                            Err(e) => { warn!("Discord bot init failed: {e}"); return; }
                        };

                        tokio::select! {
                            result = client.start() => {
                                if let Err(e) = result {
                                    warn!("Discord gateway exited: {e}");
                                }
                            }
                            _ = cancel_clone.cancelled() => {
                                info!("Discord gateway stopping (credentials updated)");
                                client.shard_manager.shutdown_all().await;
                            }
                        }
                    });

                    // Wait for either a config change or the client task to end.
                    tokio::select! {
                        _ = handle => {
                            // Client exited on its own — small backoff then retry.
                            tokio::time::sleep(Duration::from_secs(3)).await;
                        }
                        _ = config_rx.changed() => {
                            // Cancel the running client and loop with new config.
                            cancel.cancel();
                        }
                    }
                }
            }
        }
    });
}

// ── tellraw builder ───────────────────────────────────────────────────────────

/// Build a rich `tellraw @a` JSON payload for a Discord-originated message.
///
/// Renders in-game as:
///   `[Discord]` (blurple #5865F2)  `username:` (gray #99AAB5 bold)  `message` (white)
///
/// Hex colours require Minecraft 1.16+; this server runs Paper 1.21.
pub fn build_discord_tellraw(username: &str, content: &str) -> String {
    serde_json::to_string(&serde_json::json!([
        { "text": "[Discord] ", "color": "#5865F2" },
        { "text": format!("{username}: "), "color": "#99AAB5", "bold": true },
        { "text": content, "color": "white" },
    ]))
    .expect("tellraw serialisation is infallible")
}
