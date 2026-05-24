use redstonecipher_server as lib;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Structured logging — level controlled by RUST_LOG env var
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let cfg = lib::config::Config::from_env();

    let pool = lib::db::init(&cfg.database_url).await?;

    // Sync any new .tar.gz archives from mc-server-1 that aren't yet in the DB.
    // Non-fatal: if mc-server-1 is offline at startup the service still starts.
    let synced = lib::minecraft::backup::sync_into_db(&pool, &cfg).await;
    if synced > 0 {
        tracing::info!("Synced {synced} new backup(s) from mc-server-1 into database");
    }

    // ── Resolve Discord configuration ───────────────────────────────────────────────────────────
    // Precedence: env vars (highest) > DB-stored credentials (lowest).
    // Env vars are kept so existing deployments keep working without UI interaction.
    let db_discord = lib::db::settings::get_discord_config(&pool, &cfg.settings_enc_key)
        .await
        .unwrap_or_else(|e| { tracing::warn!("Could not load Discord config from DB: {e}"); None });

    let initial_discord_cfg: Option<lib::discord::DiscordRuntimeConfig> =
        match (cfg.discord_bot_token.clone(), cfg.discord_webhook_url.clone(), cfg.discord_channel_id) {
            (Some(t), Some(w), Some(c)) => {
                tracing::info!("Discord config: using env vars (channel {})", c);
                Some(lib::discord::DiscordRuntimeConfig { bot_token: t, webhook_url: w, channel_id: c })
            }
            _ => match db_discord {
                Some(db) => {
                    tracing::info!("Discord config: loaded from DB (channel {})", db.channel_id);
                    Some(lib::discord::DiscordRuntimeConfig {
                        bot_token:   db.bot_token,
                        webhook_url: db.webhook_url,
                        channel_id:  db.channel_id,
                    })
                }
                None => {
                    tracing::info!("Discord bridge: not configured — set credentials in Admin → Integrations");
                    None
                }
            },
        };

    let state = lib::AppState::new(pool, cfg.clone(), initial_discord_cfg);

    // Spawn the music-player background task that auto-advances the queue.
    lib::minecraft::music::spawn_player_task(
        cfg.clone(),
        state.pool.clone(),
        state.music_current.clone(),
        state.music_tx.clone(),
    );

    // Spawn the countdown background task that ticks every second.
    lib::minecraft::countdown_runner::spawn_countdown_task(
        cfg.clone(),
        state.pool.clone(),
        state.countdown_active.clone(),
        state.countdown_tx.clone(),
    );

    // Spawn the rising-oceans background task.
    lib::minecraft::rising_oceans_runner::spawn_rising_oceans_task(
        cfg.clone(),
        state.pool.clone(),
        state.rising_oceans_active.clone(),
        state.rising_oceans_tx.clone(),
    );

    // Spawn the bounty-board background task.
    lib::minecraft::bounty_runner::spawn_bounty_task(
        cfg.clone(),
        state.pool.clone(),
        state.bounty_board_active.clone(),
        state.bounty_board_tx.clone(),
    );

    // Spawn the nearest-pin HUD task (self-paced, no channels).
    lib::minecraft::pin_hud_runner::spawn_pin_hud_task(
        cfg.clone(),
        state.pool.clone(),
    );

    // Spawn the music-zone task (region-triggered per-player playback).
    lib::minecraft::music_zone_runner::spawn_music_zone_task(
        cfg.clone(),
        state.pool.clone(),
    );

    // Spawn Discord gateway manager (hot-reload supported via watch channel).
    lib::discord::spawn_manager(
        state.discord_config_tx.subscribe(),
        cfg.clone(),
        state.pool.clone(),
        state.chat_tx.clone(),
    );

    // Clone the relay handle for the chat_watcher (outbound MC → Discord).
    let discord_relay_for_watcher = state.discord.clone();

    // Spawn the background task that tails latest.log and feeds the chat channel.
    lib::minecraft::chat_watcher::spawn(
        cfg.clone(),
        state.pool.clone(),
        state.chat_tx.clone(),
        discord_relay_for_watcher,
    );

    let app = lib::build_router(state);

    let addr = format!("{}:{}", cfg.host, cfg.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("redstoneCipher listening on http://{addr}");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("failed to install Ctrl+C handler");
    tracing::info!("Shutdown signal received");
}
