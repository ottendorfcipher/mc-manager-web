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

    // Build the optional Discord relay (requires DISCORD_WEBHOOK_URL + DISCORD_CHANNEL_ID).
    let discord_relay: Option<std::sync::Arc<lib::discord::DiscordRelay>> =
        match (cfg.discord_webhook_url.clone(), cfg.discord_channel_id) {
            (Some(webhook_url), Some(channel_id)) => {
                tracing::info!("Discord webhook relay enabled (channel {})", channel_id);
                Some(std::sync::Arc::new(lib::discord::DiscordRelay::new(webhook_url, channel_id)))
            }
            _ => {
                tracing::info!("Discord bridge disabled (DISCORD_WEBHOOK_URL / DISCORD_CHANNEL_ID not set)");
                None
            }
        };

    let state = lib::AppState::new(pool, cfg.clone(), discord_relay.clone());

    // Spawn the Discord gateway bot if a token and channel ID are configured.
    if let (Some(token), Some(channel_id)) =
        (cfg.discord_bot_token.clone(), cfg.discord_channel_id)
    {
        lib::discord::spawn(
            token,
            channel_id,
            cfg.clone(),
            state.pool.clone(),
            state.chat_tx.clone(),
        );
    }

    // Spawn the background task that tails latest.log and feeds the chat channel.
    lib::minecraft::chat_watcher::spawn(
        cfg.clone(),
        state.pool.clone(),
        state.chat_tx.clone(),
        discord_relay,
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
