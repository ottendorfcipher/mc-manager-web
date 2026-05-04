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

    let state = lib::AppState::new(pool, cfg.clone());
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
