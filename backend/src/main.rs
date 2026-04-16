mod auth;
mod config;
mod db;
mod error;
mod gcloud;
mod handlers;
mod minecraft;
mod state;

use axum::{
    routing::{delete, get, patch, post},
    Router,
};
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Structured logging — level controlled by RUST_LOG env var
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let cfg = config::Config::from_env();

    // Ensure backup directory exists at startup
    std::fs::create_dir_all(&cfg.backup_dir)?;

    let pool = db::init(&cfg.database_url).await?;

    // Sync any .tar.gz files in the backup dir that aren't yet in the DB
    let synced = db::backups::sync_from_dir(&pool, &cfg.backup_dir, "system").await?;
    if synced > 0 {
        tracing::info!("Synced {synced} existing backup(s) from disk into database");
    }

    let state = AppState::new(pool, cfg.clone());
    let app   = build_router(state);

    let addr = format!("{}:{}", cfg.host, cfg.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("MC Manager listening on http://{addr}");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

fn build_router(state: AppState) -> Router {
    let api = Router::new()
        // Auth
        .route("/me",                               get(handlers::auth::me))
        // Users
        .route("/users",                            get(handlers::users::list).post(handlers::users::invite))
        .route("/users/:email",                     patch(handlers::users::update).delete(handlers::users::remove))
        .route("/users/:email/players",             get(handlers::users::list_players).put(handlers::users::replace_players))
        .route("/users/:email/players/:ign",        delete(handlers::users::unlink_player))
        .route("/users/:email/players/:ign/gamemode", patch(handlers::users::set_player_gamemode))
        // Server
        .route("/server/status",                    get(handlers::server::status))
        .route("/server/vm/:action",                post(handlers::server::vm_action))
        .route("/server/service/:action",           post(handlers::server::service_action))
        .route("/console",                          post(handlers::server::send_console))
        // World settings
        .route("/world/gamerule/:rule",             post(handlers::server::set_gamerule))
        .route("/world/time",                       post(handlers::server::set_time))
        .route("/world/weather",                    post(handlers::server::set_weather))
        // Live data
        .route("/metrics",                          get(handlers::metrics::stream))
        .route("/mc/players",                       get(handlers::mc_players::list))
        // server.properties
        .route("/properties",                       get(handlers::properties::get_all).put(handlers::properties::update))
        // Backups
        .route("/backups",                          get(handlers::backups::list).post(handlers::backups::create))
        .route("/backups/:id",                      get(handlers::backups::download).delete(handlers::backups::delete))
        .route("/backups/:id/restore",              post(handlers::backups::restore));

    Router::new()
        .route("/auth/login",    get(handlers::auth::login))
        .route("/auth/callback", get(handlers::auth::callback))
        .route("/auth/logout",   delete(handlers::auth::logout))
        .nest("/api", api)
        // Serve compiled React frontend from ./dist
        .fallback_service(
            tower_http::services::ServeDir::new("dist")
                .fallback(tower_http::services::ServeFile::new("dist/index.html")),
        )
        .layer(TraceLayer::new_for_http())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_headers(Any)
                .allow_methods(Any),
        )
        .with_state(state)
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("failed to install Ctrl+C handler");
    tracing::info!("Shutdown signal received");
}
