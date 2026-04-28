/// Library crate root.
///
/// Splitting the crate into lib + bin lets integration tests in `tests/`
/// import the full module tree without any special hacks.
///
/// `main.rs` is kept as a thin shell that just calls `run()`.
pub mod auth;
pub mod config;
pub mod db;
pub mod error;
pub mod gcloud;
pub mod handlers;
pub mod middleware;
pub mod minecraft;
pub mod state;

pub use config::Config;
pub use state::AppState;

use axum::{
    routing::{delete, get, patch, post},
    Router,
};
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};

pub fn build_router(state: AppState) -> Router {
    let api = Router::new()
        // Auth
        .route("/me",                               get(handlers::auth::me))
        // Users
        .route("/users",                            get(handlers::users::list).post(handlers::users::invite))
        .route("/users/:email",                     patch(handlers::users::update).delete(handlers::users::remove))
        .route("/users/:email/players",             get(handlers::users::list_players).put(handlers::users::replace_players))
        .route("/users/:email/players/:ign",        delete(handlers::users::unlink_player))
        .route("/users/:email/players/:ign/gamemode", patch(handlers::users::set_player_gamemode))
        // Per-user permission overrides
        .route("/users/:email/permission-overrides",
                                                    get(handlers::roles::list_overrides)
                                                        .post(handlers::roles::add_override))
        .route("/users/:email/permission-overrides/:key",
                                                    delete(handlers::roles::remove_override))
        // Roles catalog (dynamic role management)
        .route("/roles",                            get(handlers::roles::list).post(handlers::roles::create))
        .route("/roles/:role",                      get(handlers::roles::get)
                                                        .patch(handlers::roles::update)
                                                        .delete(handlers::roles::delete))
        .route("/roles/:role/permissions",          get(handlers::roles::get_permissions)
                                                        .put(handlers::roles::set_permissions))
        // Server
        .route("/server/status",                    get(handlers::server::status))
        .route("/server/vm/:action",                post(handlers::server::vm_action))
        .route("/server/service/:action",           post(handlers::server::service_action))
        .route("/console",                          post(handlers::server::send_console))
        // Granular Minecraft server commands
        .route("/server/whitelist/:action",         post(handlers::server::whitelist_action))
        .route("/server/op/:action",                post(handlers::server::op_action))
        .route("/server/kick",                      post(handlers::server::kick_player))
        .route("/server/ban/:action",               post(handlers::server::ban_action))
        .route("/server/announce",                  post(handlers::server::announce))
        .route("/server/save",                      post(handlers::server::save_world))
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
        .route("/backups/:id/restore",              post(handlers::backups::restore))
        // Kill-switch
        .route("/kill-switch",                      get(handlers::kill_switch::get)
                                                        .post(handlers::kill_switch::engage)
                                                        .delete(handlers::kill_switch::release))
        // Permission catalog (read-only; editing is via /roles/:role/permissions)
        .route("/permissions",                      get(handlers::permissions::list));

    let api = api.layer(axum::middleware::from_fn_with_state(
        state.clone(),
        crate::middleware::kill_switch_guard,
    ));

    Router::new()
        .route("/auth/login",    get(handlers::auth::login))
        .route("/auth/callback", get(handlers::auth::callback))
        .route("/auth/logout",   delete(handlers::auth::logout))
        .route("/internal/budget-alert", post(handlers::budget::webhook))
        .nest("/api", api)
        .layer(TraceLayer::new_for_http())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_headers(Any)
                .allow_methods(Any),
        )
        .layer(axum::middleware::from_fn(
            crate::middleware::tailscale_guard,
        ))
        .with_state(state)
}
